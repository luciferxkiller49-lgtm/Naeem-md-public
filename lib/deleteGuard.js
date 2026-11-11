// Bot ne khud jo message moderation (antilink / anti-features / .dellink / .delstory) ke liye delete kiya,
// uski id yahan likh di jati hai — taake antidelete use "deleted message saved" bana kar owner ki chat mein
// dobara (link samet) na bhej de.
const ids = new Map(); // messageId -> time

function mark(id) {
  if (!id) return;
  ids.set(id, Date.now());
  if (ids.size > 3000) ids.delete(ids.keys().next().value);
}
const has = (id) => ids.has(id);

module.exports = { mark, has };
