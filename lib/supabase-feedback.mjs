import crypto from "node:crypto";

const feedbackTable = "listing_title_feedback";
const feedbackImageBucket = "listing-feedback-images";

function requiredSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log("[listing-feedback] supabase config", {
    hasSupabaseUrl: Boolean(url),
    hasServiceRoleKey: Boolean(serviceRoleKey),
    bucket: feedbackImageBucket
  });

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase feedback storage is not configured.");
  }

  return { url, serviceRoleKey };
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json"
  };
}

function storageHeaders(serviceRoleKey, contentType) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": contentType,
    "x-upsert": "false"
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;

  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function extensionForContentType(contentType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif"
  }[String(contentType || "").toLowerCase()] || "jpg";
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function uploadFeedbackImage({ supabaseUrl, serviceRoleKey, feedbackId, image, side, required = false }) {
  if (!image?.dataUrl) {
    console.warn("[listing-feedback] image upload skipped: missing image data", {
      side,
      hasImage: Boolean(image),
      imageName: image?.name || null
    });
    if (required) {
      throw new Error(`${side} image evidence is missing.`);
    }
    return null;
  }

  const parsed = parseDataUrl(image.dataUrl);
  if (!parsed) {
    console.warn("[listing-feedback] image upload skipped: invalid data URL", {
      side,
      imageName: image?.name || null,
      dataUrlLength: image?.dataUrl?.length || 0
    });
    if (required) {
      throw new Error(`${side} image evidence is not a valid data URL.`);
    }
    return null;
  }

  const date = new Date().toISOString().slice(0, 7);
  const extension = extensionForContentType(parsed.contentType);
  const objectPath = `feedback/${date}/${feedbackId}/${side}.${extension}`;
  const encodedObjectPath = encodeStoragePath(objectPath);
  const encodedBucket = encodeURIComponent(feedbackImageBucket);
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodedBucket}/${encodedObjectPath}`;

  console.log("[listing-feedback] uploading image", {
    side,
    bucket: feedbackImageBucket,
    objectPath,
    contentType: parsed.contentType,
    bytes: parsed.buffer.length
  });

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: storageHeaders(serviceRoleKey, parsed.contentType),
    body: parsed.buffer
  });

  if (!response.ok) {
    const message = await response.text();
    console.error("[listing-feedback] image upload failed", {
      side,
      bucket: feedbackImageBucket,
      objectPath,
      status: response.status,
      message: message.slice(0, 180)
    });
    throw new Error(`Supabase image upload failed: ${response.status} ${message.slice(0, 180)}`);
  }

  console.log("[listing-feedback] image upload succeeded", {
    side,
    bucket: feedbackImageBucket,
    objectPath
  });

  return `${supabaseUrl}/storage/v1/object/authenticated/${encodedBucket}/${encodedObjectPath}`;
}

export async function createTitleFeedbackRecord({
  generatedTitle,
  correctedTitle,
  operatorId,
  frontImage = null,
  backImage = null
}) {
  const { url, serviceRoleKey } = requiredSupabaseConfig();
  const feedbackId = crypto.randomUUID();
  const frontImageUrl = await uploadFeedbackImage({
    supabaseUrl: url,
    serviceRoleKey,
    feedbackId,
    image: frontImage,
    side: "front",
    required: true
  });
  const backImageUrl = await uploadFeedbackImage({
    supabaseUrl: url,
    serviceRoleKey,
    feedbackId,
    image: backImage,
    side: "back"
  });

  console.log("[listing-feedback] final image urls", {
    feedbackId,
    front_image_url: frontImageUrl,
    back_image_url: backImageUrl
  });

  const row = {
    generated_title: generatedTitle,
    corrected_title: correctedTitle,
    front_image_url: frontImageUrl,
    back_image_url: backImageUrl,
    operator_id: operatorId,
    created_at: new Date().toISOString()
  };

  const response = await fetch(`${url}/rest/v1/${feedbackTable}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(serviceRoleKey),
      prefer: "return=representation"
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase feedback insert failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : rows;
}
