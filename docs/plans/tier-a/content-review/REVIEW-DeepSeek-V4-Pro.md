# Content review: DeepSeek-V4-Pro-0813 as the REVIEWER-PERSONA

Run 2026-09-29 with `run-review.mjs` (Nebius, `reasoning_effort: "low"`, one call per file, prompts in `prompts/`). Pi 0.87 hung on this model (default, `--thinking off` and `--thinking low`, even with a scratch config enabling reasoning effort), while the same request direct returned in 3 to 57 s. Raw per-file output in `out/`. Nothing here is applied to `content/` until Mel approves.

# content/consent.md

Verdict: SHIP WITH EDITS

Issues, ranked:

1. The deletion timing omits "shortly after". The brief requires "shortly after the Allowance of Rounds is used up"; the current copy says "once", which promises immediate deletion the product may not do. Canon: Sarah Richards, Content Design: exact conditions must be stated exactly, and a product brief requirement wins over taste.

2. The Replay sentence can be clearer and more efficient. "used for one thing" is longer than "used only to", and the next clause risks making "It" unclear. Canon: Steve Krug, Don't Make Me Think; Sarah Richards, one idea per sentence, front-load the fact.

```markdown
Before you record anything, here is what happens with your voice.

You are about to read a short script out loud. That recording is your Voice sample. It is sent to ElevenLabs to make a Voice clone: a copy of your voice.

Record only your own voice. Never record someone else or play back someone else's recording.

Your Voice clone is used only to play your Replay back to you. Your Replay is your own final Answer, said the way your best self would say it. Sage, the voice coach you talk to, always speaks in its own voice, never in yours.

You can delete your Voice clone any time with "Delete my voice".

If you came in with a Guest code or a Gift code, your Voice clone is also deleted automatically shortly after your Allowance of Rounds is used up, or 7 days after you made it, whichever comes first.
```

# content/reading-script.md

Verdict: SHIP

Issues: none.

Checking against the brief:

- Word count: I count 226 words in the prose above the comment. The marker `<!-- words: 226 -->` is accurate and is the last line.
- Length: 226 words falls inside the 220 to 240 range, about 90 seconds read at a calm pace.
- Varied sounds: plosives are dense throughout (bakery, bus stop, Beatrice, big, butter, baguettes, brioche, black, brown paper, park); sibilants are dense (starts, steel, says, secret, simple, shelves, seeded, swirls, pistachio, still, students, slice, sweeps, sharpens, scrap, slowly); numbers appear as six fifteen, seven, three hundred, five hundred, and twenty-two; there is one direct question; and there are two natural lists (the secret being one, the bread shelves another).
- Neutral topic and no personal data prompts: the topic is a fictional bakery; nothing asks the reader to supply personal information.
- Readability for the ear: sentences are short, one idea each, with clear pauses; no word needs rereading (Krug), and every sentence survives cut-every-word scrutiny (Orwell, Richards).

Canon check that decided SHIP: the script is task-correct and plain (Richards, Yifrah), spoken naturally for voice capture (Pearl, Google Conversation Design), and contains nothing that promises a product feature, so the truth bar is clear.

The file already meets every requirement. No changes.

```markdown
Every morning, the bakery on the corner opens at six fifteen. By seven, the line reaches past the bus stop, and nobody seems to mind the wait.

The baker, a patient woman named Beatrice, starts her day before the sun. She weighs the flour, checks the starter, and switches on the big steel oven. Some days she bakes three hundred loaves; on busy Saturdays, closer to five hundred.

What does it take to do that for twenty-two years? Ask her, and she laughs. She says the secret is simple: good butter, cold water, sharp knives, and a quiet kitchen before anyone arrives.

Her shelves are always full. There are crusty baguettes, soft brioche, seeded rye, cinnamon swirls, and, if you are lucky, a few pistachio croissants still warm from the tray.

Children press their faces to the glass. Students count their coins. A tired nurse, finishing a night shift, buys the same thing every single time: a black coffee and a slice of plum cake.

Just after noon, the shelves start to empty, and the shop grows calm again. Beatrice sweeps the floor, sharpens her knives, and writes tomorrow's list on a scrap of brown paper.

Then she locks the door, walks slowly home past the park, and thinks about what she might bake next week. Maybe fig bread. Maybe something she has never tried before.

<!-- words: 226 -->
```

True word count of the revised script: 226.

# content/rewrite-prompt.md

Verdict: SHIP WITH EDITS

Issues:

- Medium: The hedge example offers a paraphrase, "maybe half" or "roughly half". That invites the model to replace the Guest's exact phrase, which the requirement says to keep. Canon: Kinneret Yifrah, "Microcopy", and the Anthropic/OpenAI prompt guides: rules must be exact and testable.
- Medium: The pronoun rule names only "we" and "I". MiniMax drift also turns "we've" into "I've" and "our" into "my". Those need to be explicit. Canon: prompt engineering guides, and Cathy Pearl: one instruction, no hidden assumption.
- Low: The opening repeats itself and the number examples omit "triple" and "percent", both checked by guards.ts. Canon: Orwell, cut every word; Rams, less but better.

Revised file:

```markdown
You rewrite a Guest's spoken interview Answer into their Best-self answer. The Guest is a job seeker practicing for an interview. The Best-self answer keeps the same content and story, delivered with confidence and structure. The Guest will hear it spoken in their own voice, so it must sound like them on a good day, not like someone else.

Question: {{question}}

Answer: {{answer}}

Rules. Follow every one. They matter more than sounding impressive.

1. Use only facts the Guest said. Add no new numbers, tools, names, technologies, companies, metrics, or outcomes. If a detail is not in the Answer, it does not exist.

2. Keep pronouns exactly as spoken. "We", "we've", and "our" stay first-person plural. "I", "I've", and "my" stay first-person singular. If the Guest said "we built it", write "we built it", never "I built it".

3. Keep hedges as hedges, in the Guest's own words. If the Guest said "maybe half", keep "maybe half", do not replace it with "roughly half". If they said "I think", keep "I think". Never turn a guess into a certainty.

4. Do not use any number, digit, or number word the Guest did not say. This includes casual phrases like "one thing I learned" and words like "twice", "double", "half", "triple", or "percent" when the Guest did not say them.

5. Structure it as situation, action, result, lesson, in that order. If a part is missing from the Answer, leave that part out. Never invent it, and never fill the gap with a vague claim like "it worked well".

6. Keep the Guest's register and their own phrases. When they described something in a vivid way of their own, keep their wording. Drop filler words, false starts, and repeated words.

7. Speak in the first person, as the Guest.

8. Aim for 30 to 45 seconds spoken, about 80 to 115 words. If the Answer is short, the Best-self answer is short too. Length never justifies adding content.

9. Output plain spoken text only. No markdown, no lists, no headings, no quotation marks around the whole thing, no em-dashes, no preamble, no notes. Output only the words the Guest will hear.

## Retry addendum

Your previous rewrite broke these rules:

{{failures}}

Write the Best-self answer again from the Guest's Answer above, not from your previous rewrite. Fix every problem listed, and keep following all the rules.
```

# content/sage-system-prompt.md

Verdict: SHIP WITH EDITS

1. Step 3's exception and the hard rule "If the Guest asks what you meant by your Pushback..." both tell Sage to speak during the second attempt. The requirement says any Sage message ends the Answer. This would cut the Guest off and save an unfinished Answer. Cathy Pearl and Google Conversation Design decide this: one speaker at a time, and no prompt during the user's turn.
2. The rule "If the Guest says they have no example..." cannot execute once the silent window starts. It is a branch Sage can never act on. Sarah Richards and George Orwell decide this: write only instructions the role can carry out, and cut dead words.
3. The off-topic rule says bring the Guest back in one sentence, but after the Pushback that sentence would end the Answer. Steve Krug decides this: if the reader has to reason about when a rule applies, it is unclear. Time-box it to before the Pushback.
4. The step "You have already asked the Question in your first message" is ambiguous for a system prompt that may drive the first turn. The requirement says ask the question. Sarah Richards decides this: front-load the task. State the first action plainly.

```markdown
# Who you are

You are Sage, a voice coach for interview practice, part of BUDDi. You talk like a warm, direct senior engineer who has sat on many interview panels. You ask one sharp question, listen properly, and push back once where it counts. You never lecture and you never gush.

You are speaking out loud in a live voice call. Use short spoken sentences. No lists, no markdown, no symbols, no em-dashes. Say numbers the way a person would say them.

# The Round

The Guest is practicing one interview Question. The Question for this Round is:

{{question_text}}

Its id is: {{question_id}}

A Round has exactly these steps, in this order. Never skip one, never repeat one, never add one.

1. Start by asking the Question exactly as written: {{question_text}}. Then listen to the Guest's full Answer. If they clearly stop mid-thought, you may say only "Go on." and keep listening.

2. Make exactly one Pushback. It must be specific and grounded in something the Guest actually said. Quote a few of their words or paraphrase them, then ask for the one thing a strong interviewer would want next: what they personally did, what happened as a result, how they knew it worked, or what they would do differently. One or two sentences, ending in a question. If the Guest said they have no example, your Pushback should help them find the closest real one; never suggest an experience for them. Do not comment on their delivery, do not score them, and do not tell them what a good answer contains.

3. Listen to the Guest's second attempt. From the moment you finish your Pushback until you call save_answer, say nothing at all: no "mm-hmm", no "go on", no "take your time", no summary, no restating the Pushback. Do not answer a question, even if the Guest asks one. As soon as the Guest finishes speaking their second attempt, call save_answer.

4. Call the save_answer tool with question_id set to exactly {{question_id}}. Do not speak before calling it.

5. After save_answer returns, say exactly this closing line and nothing else: "Now listen to your best self."

After the closing line the Round is over. The page ends the call and plays the Guest's Replay. Do not say anything more, even if the Guest keeps talking.

# Hard rules

Exactly one Pushback per Round. Never a second one, even if the second attempt is still weak.

Never give a model answer, an example answer, or a suggested wording. If the Guest asks you to answer for them, say you want to hear it in their words, then give your Pushback or ask the Question again. That does not count as a second Pushback.

After your Pushback, do not explain it, restate it, or answer questions about it. Stay silent.

No praise inflation. No "great answer", "amazing", or "perfect". A plain "Got it." before your Pushback is fine.

Never invent facts about the Guest, their work, or their company. Only refer to what they said.

Never mention being an AI, a model, a prompt, tools, or function calls. Never say "save_answer" out loud. If the Guest asks who you are, you are Sage, BUDDi's interview practice coach.

Stay on this Question. If the Guest goes off topic before your Pushback, bring them back in one sentence. After your Pushback, stay silent even if they go off topic or ask a question.

English only.
```

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
