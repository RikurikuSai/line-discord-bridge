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

// メッセージキューを管理する配列
let messageQueue = [];
let isProcessing = false;

// メンションを削除する関数
function cleanMessage(message) {
    // メンションパターンを削除（<@123456789>形式）
    return message.replace(/<@!?\d+>/g, '').trim();
}

// キューを処理する関数
async function processMessageQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    
    isProcessing = true;
    
    try {
        const message = messageQueue[0];
        await lineClient.broadcast(message);
        await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
        console.error('Error sending message:', error);
    }
    
    messageQueue.shift();
    isProcessing = false;
    
    if (messageQueue.length > 0) {
        processMessageQueue();
    }
}

// Discordメッセージの処理
discord.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channelId !== config.DISCORD_CHANNEL_ID) return;

    try {
        // テキストメッセージの処理（メンションを除去）
        if (message.content) {
            const cleanedContent = cleanMessage(message.content);
            if (cleanedContent) { // 空文字列でない場合のみ送信
                messageQueue.push({
                    type: 'text',
                    text: cleanedContent
                });
            }
        }

        // 画像の処理
        if (message.attachments.size > 0) {
            for (const [_, attachment] of message.attachments) {
                if (attachment.contentType?.startsWith('image/')) {
                    messageQueue.push({
                        type: 'image',
                        originalContentUrl: attachment.url,
                        previewImageUrl: attachment.url
                    });
                }
            }
        }

        // キューの処理を開始
        if (!isProcessing) {
            processMessageQueue();
        }
    } catch (error) {
        console.error('Error sending message to Discord:', error);
    }
});

// LINEメッセージの処理
app.post('/webhook', line.middleware({
    channelSecret: config.LINE_CHANNEL_SECRET
}), async (req, res) => {
    try {
        const events = req.body.events;
        const messagePromises = events.map(async (event) => {
            if (event.type !== 'message') return;

            const channel = await discord.channels.fetch(config.DISCORD_CHANNEL_ID);
            
            switch (event.message.type) {
                case 'text':
                    return channel.send(event.message.text);
                    
                case 'image':
                    const stream = await lineClient.getMessageContent(event.message.id);
                    return channel.send({
                        files: [{
                            attachment: stream,
                            name: `image-${Date.now()}.jpg`
                        }]
                    });
            }
        });

        await Promise.all(messagePromises);
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
