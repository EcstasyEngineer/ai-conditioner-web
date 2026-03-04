# Optional `polly_text` Key for Custom Polly Input

Each audio item in your JSON files can include an optional `polly_text` field.  When present, this value will be sent to Amazon Polly instead of the default `line` text.  This makes it easy to adjust pronunciation without modifying your original script.

## JSON Example
```json
{
  "type": "audio",
  "line": "Master's voice dissolves Bambi's doubts.",
  "polly_text": "Masters voice dissolves Bambees doubts.",  # optional
  "theme": "Brainwashing",
  "dominant": "Master",
  "subject": null,
  "difficulty": "BASIC"
}
```

- `line`: The display text used in scripts and progression demos.
- `polly_text`: *(optional)* Exact text sent to Polly.  If omitted, the `line` value is used.

When you rerun the TTS generation notebook, any change in `polly_text` will produce a new audio file, and the old one will be flagged as orphaned.
