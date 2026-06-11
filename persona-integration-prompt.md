# Prompt: Integrate Lead Profile Dropdown into Student Sim

Use this prompt verbatim with Claude (or paste it into Claude Code) to add the real-student profile dropdown to the Practice page of the mock counselling trainer app.

---

## Context you must read first

- `persona-profiles.md` — the 170 real student profiles, grouped by the four persona categories. Each entry has a **label** (dropdown display text) and a **description** (the student's background, fed into the LLM as situation context).

---

## What to implement

Add a "Student profile (from real calls)" dropdown to **two pages**:

- `client/src/pages/counsellor/Practice.jsx` — the counsellor's self-directed practice flow
- `client/src/pages/admin/AssignmentCreate.jsx` — the admin's assignment creation form

Both pages already have a `situation` field inside a `scenario` object that feeds the student system prompt. The profile dropdown pre-fills that field with the selected profile's `description`. The implementation is identical on both pages.

### Step 1 — Add the data file

Create `server/data/leadProfiles.json` with this shape:

```json
{
  "profiles": [
    {
      "id": "lead-001",
      "category": "non-working",
      "name": "Sommli",
      "label": "Hesitant Sommli, 2024 graduate waiting on exams",
      "description": "Sommli is a 2024 graduate who is currently preparing for a competitive exam..."
    }
  ]
}
```

The four valid `category` values are: `studying`, `same-field`, `diff-field`, `non-working`.

Populate it with the 170 profiles from `persona-profiles.md`. Each profile needs: `id`, `category`, `name`, `label`, `description`.

### Step 2 — Add the API endpoint

In `server/index.js`, add a read-only GET endpoint:

```js
app.get("/api/lead-profiles", (req, res) => {
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "leadProfiles.json"), "utf-8"));
  let profiles = (data?.profiles || []).map(({ id, category, name, label, description }) => ({
    id, category, name, label, description
  }));
  if (req.query.category) profiles = profiles.filter(p => p.category === req.query.category);
  res.json(profiles);
});
```

### Step 3 — Map persona archetypes to profile categories

The app has persona archetypes (e.g. "Hesitant Graduate", "Working Professional") that do not have the same names as the four profile categories. You need a mapping from the persona's archetype slug/category field to one of the four profile categories. Use this mapping:

| Persona archetype (rough) | Profile category |
|---|---|
| Student / currently studying | `studying` |
| Working, same field (analytics/data/tech) | `same-field` |
| Working, different field | `diff-field` |
| Graduate / not working / between jobs | `non-working` |

Look at how personas are stored in `server/data/personas.json` to find the right field to map from. If personas already have a `category` field that matches one of the four values, no mapping is needed — filter directly.

### Step 4 — Update the Practice page and Assignment Create page

Apply the same changes to both `client/src/pages/counsellor/Practice.jsx` and `client/src/pages/admin/AssignmentCreate.jsx`. The logic is identical on both pages:

1. **Fetch all profiles once** on mount alongside the personas/courses fetch:
   ```js
   fetch("/api/lead-profiles").then(r => r.json())
   ```
   Store in `const [profiles, setProfiles] = useState([])`.

2. **Derive 10 random profiles** for the currently selected persona archetype whenever the persona selection changes:
   ```js
   const profileChoices = useMemo(() => {
     const cat = ARCHETYPE_TO_CATEGORY[selectedPersona?.category]; // use your mapping
     const matching = profiles.filter(p => p.category === cat);
     return matching.sort(() => Math.random() - 0.5).slice(0, 10);
   }, [profiles, selectedPersona]);
   ```

3. **Add a profile select dropdown** (shown only when a persona is selected and profileChoices is non-empty):
   - Label: "Student profile (from real calls)"
   - Options: `profileChoices.map(p => ({ value: p.id, label: p.label }))`
   - Include a blank "— pick a profile (optional) —" default option
   - Add a re-shuffle button so counsellors can cycle through different profiles without changing persona
   - When a profile is selected, show its `description` in a small grey paragraph below the dropdown

4. **Pre-fill scenario.situation** from the selected profile:
   ```js
   const selectedProfile = profileChoices.find(p => p.id === profileId) || null;
   // When building the session start payload:
   situation: selectedProfile?.description || situation.trim()
   ```
   If a profile is selected, its description becomes the situation text. The counsellor can still manually override the situation text box after selecting a profile (the text box shows the pre-filled value and stays editable).

### Step 5 — Verify the prompt receives it

In `server/prompt.js`, find the `buildScenarioSection` function. Confirm it includes `scenario.situation` in the output like this:

```js
if (scenario.situation) lines.push(`- Your situation right now: ${scenario.situation}`);
```

If it does, no changes needed — the description will automatically appear in the student system prompt once it reaches `scenario.situation`.

---

## What NOT to change

- Do not modify the scoring, report generation, or phase state machine.
- Do not change `server/data/student_lines.json` or `server/data/personaLines.json` — those are the register reference lines, separate from profile descriptions.
- The profile dropdown is **optional** — the session must still be startable without selecting a profile (counsellors can write a custom situation manually as before).

---

## Quick sanity check

After implementing, start a session with a profile selected. Open the server logs and confirm the student system prompt contains the line:

```
- Your situation right now: [the profile's description text]
```

If it appears, the integration is working.
