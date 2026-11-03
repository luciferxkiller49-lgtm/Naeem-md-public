const store = require('../lib/store');

const commands = [
  {
    name: 'tagall',
    aliases: ['everyone', 'all'],
    description: 'Tag all group members with a custom message',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ This command can only be used in groups.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ You must be a group admin to tag all members.');

      const metadata = await ctx.sock.groupMetadata(ctx.from);
      const participants = metadata.participants.map(p => p.id);

      const notice = ctx.text || 'Attention everyone!';
      let message = `📢 *ATTENTION ALL MEMBERS*\n` +
        `💬 *Message:* ${notice}\n\n`;

      participants.forEach((jid, i) => {
        message += `${i + 1}. @${jid.split('@')[0]}\n`;
      });

      await ctx.sock.sendMessage(ctx.from, {
        text: message,
        mentions: participants
      });
    }
  },
  {
    name: 'hidetag',
    aliases: ['htag'],
    description: 'Broadcast a message to everyone invisibly tagging them',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');

      const metadata = await ctx.sock.groupMetadata(ctx.from);
      const participants = metadata.participants.map(p => p.id);
      const message = ctx.text || 'Announcement from admin!';

      await ctx.sock.sendMessage(ctx.from, {
        text: message,
        mentions: participants
      });
    }
  },
  {
    name: 'kick',
    aliases: ['remove'],
    description: 'Remove a member from the group',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Bot needs to be an admin to remove members.');

      let target = ctx.msg.message?.extendedTextMessage?.contextInfo?.participant;
      if (!target && ctx.args[0]) {
        target = ctx.args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      }

      if (!target) return ctx.reply('❌ Please reply to a user or mention their number to remove.');

      await ctx.sock.groupParticipantsUpdate(ctx.from, [target], 'remove');
      await ctx.reply(`👋 Member @${target.split('@')[0]} has been removed.`);
    }
  },
  {
    name: 'promote',
    aliases: ['admin'],
    description: 'Promote a member to group admin',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Bot must be an admin.');

      let target = ctx.msg.message?.extendedTextMessage?.contextInfo?.participant;
      if (!target && ctx.args[0]) {
        target = ctx.args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      }

      if (!target) return ctx.reply('❌ Please mention or reply to a user to promote.');

      await ctx.sock.groupParticipantsUpdate(ctx.from, [target], 'promote');
      await ctx.reply(`👑 Member @${target.split('@')[0]} is now an admin.`);
    }
  },
  {
    name: 'demote',
    aliases: ['unadmin'],
    description: 'Demote an admin back to regular member',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Bot must be an admin.');

      let target = ctx.msg.message?.extendedTextMessage?.contextInfo?.participant;
      if (!target && ctx.args[0]) {
        target = ctx.args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      }

      if (!target) return ctx.reply('❌ Please mention or reply to an admin to demote.');

      await ctx.sock.groupParticipantsUpdate(ctx.from, [target], 'demote');
      await ctx.reply(`🛡️ Admin @${target.split('@')[0]} has been demoted.`);
    }
  },
  {
    name: 'mute',
    aliases: ['close'],
    description: 'Mute group so only admins can send messages',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Bot must be an admin.');

      await ctx.sock.groupSettingUpdate(ctx.from, 'announcement');
      await ctx.reply('🔒 Group has been muted. Only admins can send messages now.');
    }
  },
  {
    name: 'unmute',
    aliases: ['open'],
    description: 'Unmute group so all participants can send messages',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isAdmin && !ctx.isOwner) return ctx.reply('❌ Admin permission required.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Bot must be an admin.');

      await ctx.sock.groupSettingUpdate(ctx.from, 'not_announcement');
      await ctx.reply('🔓 Group has been unmuted. All members can chat now.');
    }
  },
  {
    name: 'grouplink',
    aliases: ['gclink', 'link'],
    description: 'Get group invite link',
    category: 'group',
    async execute(ctx) {
      if (!ctx.isGroup) return ctx.reply('❌ Group only command.');
      if (!ctx.isBotAdmin) return ctx.reply('❌ Bot must be an admin to retrieve invite code.');

      const code = await ctx.sock.groupInviteCode(ctx.from);
      await ctx.reply(`🔗 *Group Invite Link:*\nhttps://chat.whatsapp.com/${code}`);
    }
  }
];

module.exports = commands;
