export const v4SchemaVersion = "v4-recognition-session-v1";

export const v4ApiVersion = "v4-pai-milestone-1-4";

export function withV4Version(payload = {}) {
  return {
    v4_schema_version: v4SchemaVersion,
    v4_api_version: v4ApiVersion,
    ...payload
  };
}
