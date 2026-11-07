// Group participants ko LID aur phone-number dono IDs se pehchanne ke helpers
const userPart = (jid) => String(jid || '').split('@')[0].split(':')[0];

function idsOf(p) {
  return [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(userPart);
}
function findParticipant(participants, jid) {
  const u = userPart(jid);
  if (!u) return null;
  return (participants || []).find((p) => idsOf(p).includes(u)) || null;
}
const isAdminP = (p) => !!p && (p.admin === 'admin' || p.admin === 'superadmin');

function senderIsAdmin(participants, msg) {
  return [msg.key.participant, msg.key.participantAlt, msg.key.participantPn]
    .filter(Boolean)
    .some((j) => isAdminP(findParticipant(participants, j)));
}
function botIsAdmin(participants, sock) {
  return [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber]
    .filter(Boolean)
    .some((j) => isAdminP(findParticipant(participants, j)));
}

module.exports = { userPart, idsOf, findParticipant, isAdminP, senderIsAdmin, botIsAdmin };
