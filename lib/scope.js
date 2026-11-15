// Group settings ka daira (scope):
//  - Group ke andar se command  -> sirf wahi group.
//  - Owner ki self chat (DM) se -> wo sab groups jin mein bot hai (admin-only features ke liye sirf wo jahan bot admin hai).
const bare = (j) => String(j || '').split('@')[0].split(':')[0];

function botIsAdminIn(meta, sock) {
  const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map(bare);
  return (meta?.participants || []).some((p) => p.admin && [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).some((x) => me.includes(bare(x))));
}

async function groupTargets(ctx, { adminOnly = false } = {}) {
  if (ctx.isGroup) return { jids: [ctx.from], self: false };
  let all = {};
  try { all = (await ctx.sock.groupFetchAllParticipating()) || {}; } catch (e) { all = {}; }
  const jids = Object.entries(all)
    .filter(([, meta]) => !adminOnly || botIsAdminIn(meta, ctx.sock))
    .map(([jid]) => jid);
  return { jids, self: true };
}

module.exports = { groupTargets, botIsAdminIn };
