# The Card file is shaped for structured outputs

A Card file's JSON Schema is what an LLM API with structured outputs is given, so the format keeps to what every provider's strict mode accepts. OpenAI's needs every property required and `additionalProperties: false` on every object; Claude's refuses string-length limits; neither accepts an object with free-form keys. So every key of a Card file is always present: a Card with no grading notes says `"gradingNotes": null`, one with no Tags says `"tags": []`, and a file that doesn't point at its schema says `"$schema": null`. The macros its Formulas use are a list of `{ "name", "definition" }` pairs beside the Cards rather than a map from name to definition, and the limits on lengths and on what a Tag may hold are written in the schema's descriptions, not as keywords, and enforced by Banki on import. The format is one schema for everything: exports, hand-written files and LLM output.

## Considered Options

- **Optional keys, with a second strict schema for generation**: lighter files, but two schemas to keep in step, and a file one accepts that the other refuses.
- **Optional keys and one schema**: simplest to write by hand, but OpenAI's strict mode refuses the schema, so it works there only without guarantees.
- **Macros in a file of their own beside the Cards, in an export's zip**: the JSON would hold Cards only, but a pasted or plain `.json` import would never carry its macros.

## Consequences

- A hand-written Card file that leaves out `tags` or `gradingNotes` is refused, with an error that names the missing key.
- Version 1 can't take an optional key later; a new key, even one that may be `null`, needs version 2.
