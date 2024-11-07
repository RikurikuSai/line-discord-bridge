const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const line = require('@line/bot-sdk');
const app = express();

// 設定
const config = {
    // Discord設定
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
    
    // LINE設定
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
    
    PORT: process.env.PORT || 3000
};

// Discord クライアントの設定
const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// LINE クライアントの設定
const lineClient = new line.Client({
    channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: config.LINE_CHANNEL_SECRET
});

// Discordメッセージの処理
discord.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channelId !== config.DISCORD_CHANNEL_ID) return;

    try {
        // LINEにメッセージを送信
        await lineClient.broadcast({
            type: 'text',
            text: `${message.author.username}: ${message.content}`
        });
    } catch (error) {
        console.error('Error sending message to LINE:', error);
    }
});

// LINEメッセージの処理
app.post('/webhook', line.middleware({
    channelSecret: config.LINE_CHANNEL_SECRET
}), async (req, res) => {
    try {
        const events = req.body.events;
        for (const event of events) {
            if (event.type !== 'message' || event.message.type !== 'text') continue;

            const channel = await discord.channels.fetch(config.DISCORD_CHANNEL_ID);
            await channel.send(`${event.source.userId}: ${event.message.text}`);
        }
        res.status(200).end();
    } catch (error) {
        console.error('Error processing LINE webhook:', error);
        res.status(500).end();
    }
});

// サーバーの起動
discord.login(config.DISCORD_TOKEN);
app.listen(config.PORT, () => {
    console.log(`Server is running on port ${config.PORT}`);
});
