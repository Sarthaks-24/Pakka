# Pakka: a voice deal guard for cross-language trade

**Problem.** Small Indian traders often settle deals across languages. A Surat cloth seller speaks Gujarati, the buyer in Delhi speaks Hindi. "500 at 118, next Friday" hides three questions: 500 meters or 500 rolls, GST included or extra, and which Friday. A translator passes the words across unchanged. The gap shows up after delivery, as a dispute about money.

**What Pakka does.** Each side holds a button and talks in their own language. Pakka transcribes the speech, translates it and checks every deal term (product, quantity, price, delivery, payment) before the other side hears anything. If a term could mean two things, Pakka holds the message and asks the speaker one short question, aloud and in their own language, with tap options. Only the settled message goes across, with the agreed terms spelled out. At the end both sides get one confirmed terms card in both languages, read aloud, with a JSON download.

**How it uses Gnani.**

| Step | Provider |
|---|---|
| Speech to text, Gujarati and Hindi | Gnani Prisma STT (`prisma-v3.0`) |
| Translation, clarification questions, terms card read aloud | Gnani Timbre TTS (`timbre-v3.0`) |
| Translation text and three judgement flags (vague product spec, vague "ok", currency) | Gemini, behind one function |
| Ten ambiguity rules, Indian number words, number guard, hold or release gate | Our code |

Gnani has no translation API, so Gemini translates. The model never decides what is held: deterministic code checks every slot, and a number guard drops any number the speaker did not say. Questions come from fixed templates, so they cannot be mistranslated.

**What it catches.** Missing unit (A1), rolls or bales without a length (A2), relative dates like "next Friday" (A3), GST not stated (A4), price basis missing (A5), advance without a balance date (A6), vague product spec (A7), a changed price applied without a change word (A8), "ok" after two different offers (A9), currency unclear (A10).

**Measured on a live run (10 Nov 2026).** Gnani Prisma transcribed the seller's Gujarati clip in 4.1 s and the buyer's Hindi clip in 1.7 s, close to word for word. Gemini answered in 2 to 6 s per turn when the free tier was not overloaded. The backend has 81 automated tests. A 30-dialogue labelled eval set is in the repo; precision and recall are not reported yet because the Gemini free tier allows 20 calls per model per day.

**Who it is for.** Small traders, brokers and buyers in India who negotiate by voice across Gujarati, Hindi and Hinglish, and anyone who loses money when "pakka" turns out not to be.

**Built with.** React 19, Vite, TypeScript, Tailwind; Express 5, MongoDB; Gnani Prisma and Timbre over REST; Gemini. All dialogues and audio are synthetic.

**Next.** Native-speaker review of the Gujarati and Hindi templates, more language pairs (Tamil, Marathi), two-device calls, and a phone line version.
