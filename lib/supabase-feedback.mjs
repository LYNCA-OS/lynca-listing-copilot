const feedbackTable = "listing_title_feedback";

function requiredSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export async function createTitleFeedbackRecord({
  generatedTitle,
  correctedTitle,
  operatorId,
  frontImageUrl = null,
  backImageUrl = null
}) {
  const { url, serviceRoleKey } = requiredSupabaseConfig();
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

