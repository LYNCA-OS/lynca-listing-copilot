import { createHash } from "node:crypto";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_SHA256 =
  "fa248c5cd3b0f52bfa3554bbe96d4a84d80de94f6cc3e003494e09d75793efc7";
export const CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA_SHA256 =
  "ec1f0851a88c41a73858fc657cc6f7611d030b3fdaf08ae9e0d390fde5be3197";

// Immutable executable assets captured from Production Git object e1ae9a9.
// Keep these literals independent of the forward schema/prompt: exact bytes,
// key order and omissions are part of the rollback writer contract.
export const CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT =
  "Read this trading card and report what is printed on it. Inspect in this order before answering: (1) the slab label if there is one, (2) the card front for the subject, the parallel/finish wording and small foil limited numbering, (3) the card back for product and identity code, (4) the grade and autograph areas. Do this even when the identity already seems obvious. A slab label is a literal identity map: read year, product, subject, insert, code, the full card grade and any separate autograph grade straight off it. Never collapse PSA 9 plus AUTO 10 into PSA 9, and never turn AUTO 9 into Authentic. Never return only a year or only a product when the same label also shows a readable subject, grade or code. When two images are the front and back of one card, combine them: subject and visible finish from the front, product and identity code from the back. Report every field you can actually read. The title downstream has an 80-character budget and unreported fields simply waste it -- uncertainty about one field must never make you leave another one empty. At the same time, do not invent: report only what is visible in these images, never what this card usually says. Leave a field empty when the card does not have it. Name a field in `unreadable` when it is there but you cannot make it out at all. If you can see a value but are not confident in it, REPORT IT and name the field in `low_confidence`. Do not leave it empty -- a listing can flag a field for review, but it cannot review a field you omitted. Each field holds only its own value: do not compose a listing title, and do not repeat the same word across two fields. The parallel is asked for in three separate pieces and you should answer whichever ones you can: `surface_color` is just the basic colour (a shimmering gold card is simply Gold); `parallel_family` is the finish treatment (Refractor, Prizm, Mojo -- the hobby uses a small fixed set); `parallel_exact` only when the full name is literally printed. Answering the colour alone is a good answer -- the composer combines them. Read `product`, `set` and `card_name` in that order: the product line, then the named insert or subset within it, then -- only if something is left -- what names THIS card apart from the others in that same set. When the product and the set already account for the whole printed phrase, `card_name` is empty; most cards have no card name at all. `release_variant` is a layout difference only (Horizontal, Variation). Give the FULL printed product phrase: \"Leaf Metal Draft\" not \"Leaf Metal\", \"Topps Chrome Disney 100\" not \"Topps Chrome\". A missing word there is a missing word in the listing. The stamped print run (17/50) and the checklist code (#221) are different things and must never be put in each other's field.";
export const CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA = deepFreeze({
  "type": "object",
  "additionalProperties": false,
  "required": [
    "year",
    "manufacturer",
    "product",
    "set",
    "subjects",
    "team",
    "card_name",
    "release_variant",
    "surface_color",
    "parallel_family",
    "parallel_exact",
    "descriptive_rarity",
    "card_number",
    "serial",
    "attributes",
    "grading_info",
    "grammar",
    "lot_count",
    "language",
    "unreadable",
    "low_confidence",
    "special_stamp",
    "description"
  ],
  "properties": {
    "year": {
      "type": "string",
      "description": "Season or copyright year as printed: \"2023\" or \"2023-24\". Prefer the slab label. A statistics year on the back is not the issue year."
    },
    "manufacturer": {
      "type": "string",
      "description": "The card publisher as printed: Panini, Topps, Upper Deck. NEVER the grading company, the team, the copyright line, or a legal entity name."
    },
    "product": {
      "type": "string",
      "description": "The product line as the market names it: Prizm, Donruss Optic, Chrome, Impeccable, Flawless, Immaculate Collection, Exquisite Collection. Give the fullest printed product phrase once; do not repeat the manufacturer here. Read `product`, then `set`, then `card_name`, in that order."
    },
    "language": {
      "type": "string",
      "enum": [
        "",
        "EN",
        "JP",
        "CN",
        "KR",
        "French",
        "German",
        "Italian",
        "Spanish",
        "Portuguese"
      ],
      "description": "For trading-card-game cards only: the printed language of the card. Use EN, JP, CN or KR for those four; spell out any other language. Empty for sports cards and whenever the language is not evident."
    },
    "set": {
      "type": "string",
      "description": "The named insert or subset WITHIN that product: \"Jersey Number Autographs\", \"Draft Pick Autographs\", \"Logoman Autographs\", \"Timeless Moments\", \"Sapphire Selections\". Take the whole printed insert phrase, even where it repeats a word from the product. Empty only when the product name is the whole of it."
    },
    "card_name": {
      "type": "string",
      "description": "ONLY what names THIS card apart from the others in the same set: \"Downtown!\", \"Rated Rookie\", \"Next Stop Signatures\", \"Passing the Torch\", \"Illustrator\". When the product and the set already account for the whole printed phrase, this is EMPTY -- empty is the correct answer there, not a gap. \"Jersey Numbers\" and \"Logoman Autographs\" are sets, not card names. NOT the player name, NOT the parallel, NOT an attribute such as Auto."
    },
    "release_variant": {
      "type": "string",
      "description": "Layout or design variation only: Horizontal, Vertical, Variation, Photo Variation, International. NOT a colour, NOT a finish, NOT FOTL/Hobby/Retail."
    },
    "surface_color": {
      "type": "string",
      "enum": [
        "",
        "Gold",
        "Silver",
        "Red",
        "Blue",
        "Green",
        "Orange",
        "Purple",
        "Pink",
        "Black",
        "Yellow",
        "Teal",
        "Bronze",
        "Platinum",
        "Emerald",
        "White",
        "Aqua",
        "Rainbow"
      ],
      "description": "The BASIC colour of the parallel, if the card is visibly a coloured parallel. Just the colour -- a shimmering gold card is \"Gold\". Empty only if the card has no colour treatment at all."
    },
    "parallel_family": {
      "type": "string",
      "enum": [
        "",
        "Refractor",
        "Prizm",
        "Holo",
        "Foil",
        "Sapphire",
        "Mojo",
        "Wave",
        "Shimmer",
        "Sparkle",
        "Pulsar",
        "Geometric",
        "Hyper",
        "Shock",
        "Velocity",
        "Disco",
        "Scope",
        "Marble",
        "Cracked Ice",
        "Xfractor",
        "Raywave",
        "Prismatic",
        "Lucky"
      ],
      "description": "The finish family, if you recognise it. These are the standard treatments the hobby uses -- there are not many of them. Empty if you cannot tell which."
    },
    "parallel_exact": {
      "type": "string",
      "description": "The full printed parallel name ONLY if it is actually written on the card or slab: \"Gold Vinyl\", \"Mega Box Mojo\". Empty otherwise -- do not construct it from the colour and family, the composer does that."
    },
    "descriptive_rarity": {
      "type": "string",
      "description": "Printed scarcity wording: SSP, SP, Case Hit, 1st Bowman. Empty unless stated on the card or slab."
    },
    "subjects": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Person or character name only, as printed -- not the team, not the product. For TCG the subject is the character (Pikachu) and the printed card-title segment (Illustrator) belongs in card_name. Up to 3 for a lot; exactly 1 for a single card."
    },
    "team": {
      "type": "string",
      "description": "Team, club, country, or division printed on the card: \"Lakers\", \"Mets\". Use the short form a seller would write, not the full city name."
    },
    "card_number": {
      "type": "string",
      "description": "Checklist code exactly as printed, WITHOUT the # sign: \"221\", \"GS-AKA\", \"086/070\". A checklist code never contains a slash on a non-TCG card."
    },
    "serial": {
      "type": "string",
      "description": "Limited print run as stamped, WITH the numerator: \"17/50\", \"2/3\", \"1/1\". Read both numbers digit by digit and transcribe exactly what is stamped -- do not round, reorder, or infer from the product. If either number is not clearly legible, leave this empty and put \"serial\" in `unreadable` rather than guessing. This is NOT the checklist code."
    },
    "attributes": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "Auto",
          "RC",
          "Patch",
          "Relic",
          "Jersey",
          "SP",
          "SSP",
          "1st Edition"
        ]
      },
      "description": "Physical components only, from visible evidence: Auto needs real ink, an autograph sticker, or printed Auto/Signed wording -- a facsimile signature graphic is not Auto. RC needs an RC logo, Rookie Ticket, Rated Rookie, or Rookie Card marker."
    },
    "grading_info": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "company",
        "card_grade",
        "auto_grade",
        "grade_type"
      ],
      "properties": {
        "company": {
          "type": "string",
          "description": "Grading company exactly as printed: PSA, BGS, CGC, SGC, SCD. Empty for a raw card."
        },
        "card_grade": {
          "type": "string",
          "description": "The card-condition grade only, such as 10, 9.5, 9, AUTH or Authentic. Do not put an autograph grade here."
        },
        "auto_grade": {
          "type": "string",
          "description": "The separate autograph grade only, such as 10 or 9. Empty when no separate autograph grade is printed."
        },
        "grade_type": {
          "type": "string",
          "enum": [
            "",
            "CARD_ONLY",
            "AUTO_ONLY",
            "CARD_AND_AUTO",
            "AUTHENTIC_WITH_AUTO"
          ],
          "description": "Which literal grade panels are present. CARD_AND_AUTO means both card and autograph grades are printed."
        }
      }
    },
    "special_stamp": {
      "type": "string",
      "description": "A mark PRINTED on the card that is neither rarity nor finish: \"1st Edition\", or a promotional/tournament origin such as Staff, Promo, Prize, Tournament, Championship, CoroCoro, Parent/Child, Event. Transcribe only what is printed. Leave empty for an ordinary retail card -- most cards have no special stamp."
    },
    "description": {
      "type": "string",
      "enum": [
        "",
        "Case Hit"
      ],
      "description": "A commercial descriptor evidenced by the pack or case, not by the card face. Empty unless there is direct evidence. SSP belongs in descriptive_rarity, not here."
    },
    "grammar": {
      "type": "string",
      "enum": [
        "standard",
        "tcg",
        "lot"
      ],
      "description": "standard for sports and non-TCG singles, tcg for Pokemon/One Piece/Yu-Gi-Oh/Magic/Lorcana, lot ONLY when one image shows two or more separate physical card or slab rectangles. Several uploads of one card, or several names on one card, are not a lot."
    },
    "lot_count": {
      "type": "string",
      "description": "Number of cards in the lot, digits only. Empty unless grammar is lot and the count is countable."
    },
    "low_confidence": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "year",
          "language",
          "manufacturer",
          "product",
          "set",
          "subjects",
          "team",
          "card_name",
          "release_variant",
          "surface_color",
          "parallel_family",
          "parallel_exact",
          "descriptive_rarity",
          "card_number",
          "serial",
          "attributes",
          "grading_info",
          "special_stamp",
          "description"
        ]
      },
      "description": "Fields whose value you are reporting but are not confident about. Report the value anyway and name the field here -- a listing can flag a field for review, but it cannot review one you left out."
    },
    "unreadable": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "year",
          "language",
          "manufacturer",
          "product",
          "set",
          "subjects",
          "team",
          "card_name",
          "release_variant",
          "surface_color",
          "parallel_family",
          "parallel_exact",
          "descriptive_rarity",
          "card_number",
          "serial",
          "attributes",
          "grading_info",
          "special_stamp",
          "description"
        ]
      },
      "description": "Fields that appear to exist on the card but could not be read at all. Distinct from empty, which means the card does not have it."
    }
  }
});

if (sha256(CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT)
      !== CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT_SHA256
    || sha256(JSON.stringify(CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA))
      !== CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA_SHA256) {
  throw new Error("captured_e1ae_canonical_asset_hash_mismatch");
}
