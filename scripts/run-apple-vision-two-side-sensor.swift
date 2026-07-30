import CryptoKit
import Foundation
import ImageIO
import Vision

// Compile on macOS only:
//   swiftc -parse-as-library scripts/run-apple-vision-two-side-sensor.swift \
//     -o .local/no-provider/apple-vision-two-side-sensor
//
// The input packet is local and may contain source IDs and absolute image
// paths. The output packet contains raw OCR evidence, so it is always written
// mode 0600. It does not read truth, render titles, call a paid OCR service, or
// call the full title Provider.

struct InputRow: Decodable {
    let source_feedback_id: String
    let front_path: String
    let back_path: String
    let front_sha256: String
    let back_sha256: String
}

struct InputArtifact: Decodable {
    let schema_version: String
    let evaluation_partition: String
    let input_sha256: String
    let rows: [InputRow]
}

struct SideResult: Sendable {
    let text: String
    let error: String?
}

struct OutputRow: Encodable {
    let source_id_hash: String
    let front_sha256: String
    let back_sha256: String
    let front_text: String
    let back_text: String
    let status: String
    let error: String?
    let latency_ms: Double
}

struct Execution: Encodable {
    let row_count: Int
    let completed_count: Int
    let technical_error_count: Int
    let latency_p50_ms: Double?
    let latency_p95_ms: Double?
    let latency_p99_ms: Double?
    let latency_max_ms: Double?
    let wall_ms: Double
    let full_title_provider_calls: Int
    let paid_ocr_calls: Int
}

struct OutputArtifact: Encodable {
    let schema_version: String
    let evaluation_partition: String
    let prediction_only: Bool
    let truth_read: Bool
    let title_read: Bool
    let production_effect: String
    let input_schema_version: String
    let input_sha256: String
    let engine: String
    let engine_revision: String
    let engine_configuration: [String: String]
    let rows: [OutputRow]
    let execution: Execution
}

enum SensorError: Error {
    case imageLoadFailed(String)
}

func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

func loadImage(_ imagePath: String) throws -> CGImage {
    let url = URL(fileURLWithPath: imagePath) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw SensorError.imageLoadFailed(imagePath)
    }
    return image
}

func recognize(_ imagePath: String) -> SideResult {
    do {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        let handler = VNImageRequestHandler(cgImage: try loadImage(imagePath), options: [:])
        try handler.perform([request])
        let text = (request.results ?? []).compactMap { observation in
            observation.topCandidates(1).first?.string
        }.joined(separator: "\n")
        return SideResult(text: text, error: nil)
    } catch {
        return SideResult(text: "", error: String(describing: error))
    }
}

func milliseconds(_ start: UInt64, _ end: UInt64) -> Double {
    Double(end - start) / 1_000_000.0
}

func quantile(_ values: [Double], _ probability: Double) -> Double? {
    let sorted = values.sorted()
    guard !sorted.isEmpty else { return nil }
    let index = min(sorted.count - 1, max(0, Int(ceil(Double(sorted.count) * probability)) - 1))
    return sorted[index]
}

@main
struct AppleVisionTwoSideSensor {
    static func main() async throws {
        guard CommandLine.arguments.count == 3 else {
            throw NSError(
                domain: "AppleVisionTwoSideSensor",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "usage: apple-vision-two-side-sensor <input.json> <output.json>"]
            )
        }

        let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
        let input = try JSONDecoder().decode(InputArtifact.self, from: Data(contentsOf: inputURL))
        let wallStarted = DispatchTime.now().uptimeNanoseconds
        var rows: [OutputRow] = []
        rows.reserveCapacity(input.rows.count)

        // Front and back are independent, so they run together. Cards remain
        // serial to make the latency distribution reproducible and prevent an
        // unconstrained batch from hiding queueing inside the local sensor.
        for row in input.rows {
            let started = DispatchTime.now().uptimeNanoseconds
            async let front = Task.detached(priority: .userInitiated) {
                recognize(row.front_path)
            }.value
            async let back = Task.detached(priority: .userInitiated) {
                recognize(row.back_path)
            }.value
            let (frontResult, backResult) = await (front, back)
            let completed = DispatchTime.now().uptimeNanoseconds
            let errors = [frontResult.error, backResult.error].compactMap { $0 }
            rows.append(OutputRow(
                source_id_hash: sha256(row.source_feedback_id),
                front_sha256: row.front_sha256,
                back_sha256: row.back_sha256,
                front_text: frontResult.text,
                back_text: backResult.text,
                status: errors.isEmpty ? "COMPLETE" : "TECHNICAL_FAILURE",
                error: errors.isEmpty ? nil : errors.joined(separator: " | "),
                latency_ms: milliseconds(started, completed)
            ))
        }

        let wallCompleted = DispatchTime.now().uptimeNanoseconds
        let complete = rows.filter { $0.status == "COMPLETE" }
        let latencies = complete.map { $0.latency_ms }
        let artifact = OutputArtifact(
            schema_version: "apple-vision-two-side-sensor-v2",
            evaluation_partition: input.evaluation_partition,
            prediction_only: true,
            truth_read: false,
            title_read: false,
            production_effect: "NONE",
            input_schema_version: input.schema_version,
            input_sha256: input.input_sha256,
            engine: "Apple Vision VNRecognizeTextRequest",
            engine_revision: "default@\(ProcessInfo.processInfo.operatingSystemVersionString)",
            engine_configuration: [
                "recognition_level": "accurate",
                "recognition_languages": "en-US",
                "language_correction": "false",
                "front_back_execution": "parallel",
                "card_execution": "serial"
            ],
            rows: rows,
            execution: Execution(
                row_count: rows.count,
                completed_count: complete.count,
                technical_error_count: rows.count - complete.count,
                latency_p50_ms: quantile(latencies, 0.50),
                latency_p95_ms: quantile(latencies, 0.95),
                latency_p99_ms: quantile(latencies, 0.99),
                latency_max_ms: quantile(latencies, 1.00),
                wall_ms: milliseconds(wallStarted, wallCompleted),
                full_title_provider_calls: 0,
                paid_ocr_calls: 0
            )
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(artifact)
        try data.write(to: outputURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: outputURL.path)
        print(String(data: try JSONEncoder().encode(artifact.execution), encoding: .utf8) ?? "{}")
    }
}
