const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const line = require('@line/bot-sdk');
const app = express();

// 設定
const config = {
    // Discord設定
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID,
    // 追加の転送先チャンネルID（カンマ区切りで複数指定可能）
    DISCORD_FORWARD_CHANNEL_IDS: (process.env.DISCORD_FORWARD_CHANNEL_IDS || '').split(',').filter(id => id),
    
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

// Discordの他チャンネルにメッセージを転送する関数
async function forwardToDiscordChannels(content, files = []) {
    for (const channelId of config.DISCORD_FORWARD_CHANNEL_IDS) {
        try {
            const channel = await discord.channels.fetch(channelId);
            await channel.send({
                content: content,
                files: files
            });
        } catch (error) {
            console.error(`Error forwarding to channel ${channelId}:`, error);
        }
    }
}

// Discordメッセージの処理
discord.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channelId !== config.DISCORD_CHANNEL_ID) return;

    try {
        // LINE向けのメッセージ処理
        if (message.content) {
            messageQueue.push({
                type: 'text',
                text: message.content
            });
        }

        // 画像の処理
        const files = [];
        if (message.attachments.size > 0) {
            for (const [_, attachment] of message.attachments) {
                if (attachment.contentType?.startsWith('image/')) {
                    messageQueue.push({
                        type: 'image',
                        originalContentUrl: attachment.url,
                        previewImageUrl: attachment.url
                    });
                    files.push(attachment.url);
                }
            }
        }

        // Discordの他チャンネルへ転送
        await forwardToDiscordChannels(message.content, files.map(url => ({ attachment: url })));

        // LINEメッセージキューの処理を開始
        if (!isProcessing) {
            processMessageQueue();
        }
    } catch (error) {
        console.error('Error processing Discord message:', error);
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
            let content, files;
            
            switch (event.message.type) {
                case 'text':
                    content = event.message.text;
                    break;
                    
                case 'image':
                    const stream = await lineClient.getMessageContent(event.message.id);
                    files = [{
                        attachment: stream,
                        name: `image-${Date.now()}.jpg`
                    }];
                    break;
            }

            // メインチャンネルに送信
            await channel.send({ content, files });

            // 他のチャンネルに転送
            await forwardToDiscordChannels(content, files);
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
