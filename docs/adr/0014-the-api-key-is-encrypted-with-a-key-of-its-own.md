# The API key is encrypted with a key of its own, not the auth secret

The User's OpenRouter API key is stored in the database encrypted, with an encryption key kept apart from the auth secret: `<dataDir>/encryption-key`, generated on the first start the way `auth-secret` is, unless `ENCRYPTION_KEY` overrides it. Rotating the auth secret is how the User signs out every device (ADR-0005), and that must not also make the stored API key unreadable. A database copied on its own, without the data directory's key file, gives up no API key.

## Considered Options

- **Derive the encryption key from the auth secret**: nothing new to manage, but signing out every device would also lose the API key.
- **`ENCRYPTION_KEY` only, with no generated file**: explicit, but one more variable every installation and every Preview would have to set before grading works.

## Consequences

- A backup must keep `encryption-key` with `banki.db`. Losing or changing the key leaves the stored API key unreadable; Banki then treats it as unset and asks for it again, and nothing else is lost.
