# Speed / lite update

## Code
- `lib/mongoAuth.js` — Signal keys ab RAM mein foran update hoti hain aur Mongo mein ek batch (default 1.5s, `KEYS_FLUSH_MS`) mein likhi jati hain.
  Pehle har message/reply Atlas ke round-trip ka intezar karta tha. SIGTERM par foran flush; reconnect par purana pending flush pehle likha jata hai; logout (`deleteSession`) pending flush cancel karta hai.
  Purane instances ke closures ab RAM mein jama nahi hote.
- `bot.js` — ek upsert ke SAARE messages process hote hain (pehle sirf pehla). 90s se purane messages skip (`MAX_MSG_AGE_SEC`, 0 = band).
  Group metadata sirf tab mangi jati hai jab message command ho ya group mein koi anti-feature ON ho.
- `lib/limiter.js` — ffmpeg ek waqt mein max 2 (`FFMPEG_CONCURRENCY`). Sticker/audio temp file names ab unique. ffmpeg install na ho to ek saaf error log aata hai.
- `lib/safety.js` — cooldown Map ab barhta nahi.
- `Procfile` — `--max-old-space-size=400` (512MB dyno ke liye).
- `package.json` — `@hapi/boom` add, Node 20.x pin, unused `fluent-ffmpeg` + `qrcode-terminal` hata diye.

## Hataya gaya (kabhi chalta hi nahi tha)
- Root ki purani copies `mongoAuth.js`, `reconnect.js` (bot `lib/` wali use karta hai).
- 23 duplicate command definitions jo loader pehle hi skip karta tha (commands/moderation.js poora khali tha, delete; antidelete, antiedit, antilink, roast, joke, quote, kick, promote, demote, mute, unmute, gcstatus, hack, status, antistatus, welcome, goodbye, weather, translate) aur 2 dead aliases (`status`, `calc`).
  Command list pehle jaisi hi hai: 198 commands, 93 aliases. Ab startup par 23 collision warnings nahi aati.

## Heroku par ek baar karna hai
- ffmpeg buildpack (sticker/audio ke liye): `heroku buildpacks:add --index 1 https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest -a <app>`
- Heroku aur Atlas ka region ek hi rakhein.

## Update 2
- `lib/mongoAuth.js` — number agar kisi doosre node ke naam par pehle se Mongo mein ho to "E11000 duplicate key" ki jagah saaf message
  (linked ho ya 3 min se kam purani pairing ho) ya, agar wo purana adhoora kachra ho, to usay hata kar naya bana diya jata hai.
- Naye commands (`commands/bulk-delete.js`): `.dellink` (link wale messages) aur `.delstory` (group status posts) — group admin chalaye, bot admin ho.
  Purane naam (`.delalllink`, `.delallstatus` waghera) aliases ke taur par chalte hain. Ye pehle kisi file se load hi nahi hote the (`lib/moderation.js` orphan thi, hata di).
- Limit: bot sirf wahi messages delete kar sakta hai jo usne online rehte hue dekhe hon (restart par list khali).

## Update 3 (anti-link / anti-feature)
- Delete par koi message nahi jata (delete / all mode). Member remove hone par SIRF ek message jata hai jis mein wajah likhi hoti hai
  (`lib/removeNotice.js`). Spammer ke queue mein pade baqi messages par dobara kick/message nahi hota (2 min dedupe). Kick fail (admin/owner) ho to galat "removed" message nahi jata.
  Ye antilink aur antivoice/antisticker/antivideo/antigcstatus/antimention sab par lagu hai.
- BUG FIX: `antilink all` mode mein regex par `g` flag tha, is se har doosra link miss ho jata tha (6 mein se sirf 3 pakde jate the). Hata diya.
- Har deleted link par `[ANTILINK] Detected...` log line band (100 links = 100 log lines thi).
