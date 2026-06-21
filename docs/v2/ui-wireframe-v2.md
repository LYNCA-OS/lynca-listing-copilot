# Listing Copilot UI Wireframe v2

Status: Design Draft v2.0
Owner: LYNCA Listing Intelligence
Companion Documents:

- `feedback-loop-v2.md`
- `database-schema-v2.md`

## Purpose

This document describes the V2 feedback-loop interface at wireframe level.

It is a design document only. It does not define implementation code.

## Product Principle

```text
One Extra Click
```

The operator should only need to save the corrected title. Feedback capture, including image evidence capture, happens behind that save action.

The UI should treat image evidence as already present from upload/generation. The operator should not need to attach, label, or explain images during Save.

## User Workflow Wireframe

### Step 1: Upload

```text
+--------------------------------------------------+
| Listing Copilot                                  |
+--------------------------------------------------+
|                                                  |
|  Upload card images                              |
|                                                  |
|  [ Upload Images ]                               |
|                                                  |
+--------------------------------------------------+
```

User action:

- upload or select card images

System behavior:

- no feedback event is created

### Step 2: Generate

```text
+--------------------------------------------------+
| Listing Copilot                                  |
+--------------------------------------------------+
| Uploaded Images                                  |
|                                                  |
| [ Generate Title ]                               |
|                                                  |
+--------------------------------------------------+
```

User action:

- generate title

System behavior:

- Listing Copilot creates a generated title
- system preserves the generated title internally
- system preserves front/back image evidence references internally

### Step 3: Edit Title

```text
+--------------------------------------------------+
| Listing Copilot                                  |
+--------------------------------------------------+
| Title                                            |
| +----------------------------------------------+ |
| | 2024 Topps Chrome Victor Wembanyama ...      | |
| +----------------------------------------------+ |
|                                                  |
| [ Save ]                                         |
|                                                  |
+--------------------------------------------------+
```

User action:

- edit the title if needed

System behavior:

- no category prompt
- no tag prompt
- no explanation prompt
- no classification prompt

### Step 4: Save

```text
+--------------------------------------------------+
| Listing Copilot                                  |
+--------------------------------------------------+
| Title                                            |
| +----------------------------------------------+ |
| | Corrected final listing title                | |
| +----------------------------------------------+ |
|                                                  |
| [ Save ]                                         |
|                                                  |
+--------------------------------------------------+
```

User action:

- click Save

System behavior:

- save the listing title normally
- compare generated title with corrected title
- if changed, store a feedback event with front/back image evidence

The Save button is the feedback button.

## User Screen Requirements

The main listing screen should show:

- uploaded images
- generated/editable title field
- Save action

The main listing screen should not show:

- error category selector
- tag selector
- explanation textbox
- classification dropdown
- correction reason prompt
- training-data prompt

## Admin Workflow Wireframe

### Feedback List

```text
+------------------------------------------------------------------------------------------------+
| Admin: Title Feedback                                                                           |
+------------+----------+-------------+--------------------------+-------------------------------+
| Timestamp  | Operator | Images      | Generated Title          | Corrected Title               |
+------------+----------+-------------+--------------------------+-------------------------------+
| Jun 21     | fei      | Front Back  | 2024 Topps Chrome ...    | 2024-25 Topps Gold Wave ...   |
| Jun 21     | ops-2    | Front       | Panini Prizm Auto ...    | Panini Prizm Black Gold ...   |
+------------+----------+-------------+--------------------------+-------------------------------+
```

Admin action:

- review before/after corrections

System behavior:

- show raw feedback rows
- show image evidence availability
- sort newest first by default

### Feedback Detail

```text
+--------------------------------------------------+
| Feedback Detail                                  |
+--------------------------------------------------+
| Timestamp                                        |
| Jun 21, 2026                                     |
|                                                  |
| Operator                                         |
| fei                                              |
|                                                  |
| Generated Title                                  |
| 2024 Topps Chrome Victor Wembanyama RC Auto      |
|                                                  |
| Corrected Title                                  |
| 2024-25 Topps Chrome Victor Wembanyama RC Auto   |
|                                                  |
| Image Evidence                                   |
| [ Front Image ] [ Back Image ]                   |
|                                                  |
+--------------------------------------------------+
```

Admin action:

- inspect a row
- compare front/back image evidence with the title correction
- manually identify recurring patterns

System behavior:

- display raw stored data
- display stored image references or URLs
- do not require admin labeling

## Future Registry Review Wireframe

V2.0 does not include a registry queue.

The future review process can be represented as:

```text
+--------------------------------------------------+
| Registry Review                                  |
+--------------------------------------------------+
| Repeated Correction Pattern                      |
|                                                  |
| Images: Front + Back evidence available          |
| Generated: Orange Refractor                      |
| Corrected: Orange Raywave                        |
|                                                  |
| Evidence Count: 7                                |
|                                                  |
| [ Create Registry Candidate ]                    |
+--------------------------------------------------+
```

This is a V2.1+ concept, not a V2.0 requirement.

## V2.0 Scope

V2.0 UI includes:

- upload flow unchanged
- generated title visible in editable field
- uploaded front/back images associated with the memory event
- existing Save action
- invisible feedback capture after Save
- simple admin feedback list
- simple admin feedback detail

V2.0 UI excludes:

- operator feedback modal
- required labeling step
- admin approval queue
- correction taxonomy screen
- registry editing screen
- training dashboard

## V2.1 Expansion

Potential V2.1 UI additions:

- date filter
- operator filter
- copy row action
- CSV export action
- basic diff highlight
- image thumbnail preview
- reviewed marker
- link to registry candidate note

V2.1 should preserve the V2.0 operator experience.

The operator should still only do:

```text
Upload
  |
Generate
  |
Edit Title
  |
Save
```
