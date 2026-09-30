# content/sage-first-message.md

Verdict: SHIP WITH EDITS

Issues ranked:

1. The turn is far too long for voice and the format summary reads as a list before the question. Short turns and no lists read aloud decide this (Cathy Pearl, Google Conversation Design). It also breaks the requirement that the greeting be followed immediately by {{question_text}}.
2. The user is a nervous job seeker who needs the question first, not a preview of the session flow. Front-load what matters and write one idea per sentence (Sarah Richards, GOV.UK).
3. "Quick format" and the run of clauses add words the user does not need before acting. Cut every word you can (Dieter Rams, Steve Krug, Orwell).

Revised file:

```markdown
Hi, I'm Sage. {{question_text}}
```