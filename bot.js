require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs-extra");

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_IDS = process.env.ADMIN_IDS.split(",");
const SONGS_FILE = "songs.json";

// Fayllarni saqlash uchun papka
const MEDIA_FOLDER = "media";
fs.ensureDirSync(MEDIA_FOLDER);

let addingSong = {};

function loadSongs() {
  return fs.readJSONSync(SONGS_FILE, { throws: false }) || [];
}

function saveSongs(songs) {
  fs.writeJSONSync(SONGS_FILE, songs, { spaces: 2 });
}

// Fayllarni yuklab olish funksiyasi
async function downloadFile(fileId, fileName) {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const filePath = `${MEDIA_FOLDER}/${fileName}`;
  const response = await fetch(fileLink);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));
  return filePath;
}

bot.start((ctx) => {
  const songs = loadSongs();
  const categories = [...new Set(songs.map(song => song.category))];
  
  ctx.reply(
    "🎵 Salom! Kategoriyani tanlang:",
    Markup.keyboard(categories.map(cat => [cat])).resize()
  );
});

// Qo'shiq qo'shish boshlanishi
bot.command("addsong", (ctx) => {
  if (!ADMIN_IDS.includes(String(ctx.from.id))) {
    return ctx.reply("❌ Sizda bunday buyruqni bajarish huquqi yo'q.");
  }
  addingSong[ctx.from.id] = { step: "audio" };
  ctx.reply("🎵 Yangi qo'shiq uchun audio faylini yuboring (MP3 formatida):");
});

// Audio faylini qabul qilish
bot.on("audio", async (ctx) => {
  const user = ctx.from.id;
  if (!addingSong[user] || addingSong[user].step !== "audio") return;

  const audio = ctx.message.audio;
  addingSong[user].audioFileId = audio.file_id;
  addingSong[user].step = "photo";
  ctx.reply("✅ Audio qabul qilindi! Endi qo'shiq uchun rasm yuboring:");
});

// Rasmni qabul qilish
bot.on("photo", async (ctx) => {
  const user = ctx.from.id;
  if (!addingSong[user] || addingSong[user].step !== "photo") return;

  const photo = ctx.message.photo.pop(); // Eng yuqori sifatli rasm
  addingSong[user].photoFileId = photo.file_id;
  addingSong[user].step = "name";
  ctx.reply("✅ Rasm qabul qilindi! Endi qo'shiq nomini yozing:");
});

// Qo'shiq nomi va boshqa ma'lumotlarni qabul qilish
bot.on("text", async (ctx) => {
  const user = ctx.from.id;
  const text = ctx.message.text;

  // Qo'shiq qo'shish jarayoni
  if (addingSong[user]) {
    const data = addingSong[user];

    if (data.step === "name") {
      data.name = text;
      data.step = "category";
      ctx.reply("📂 Kategoriyasini yozing (masalan: 'Pop', 'Hip-Hop'):");
      return;
    }

    if (data.step === "category") {
      data.category = text;
      data.step = "text";
      ctx.reply("📝 Qo'shiq matnini yozing:");
      return;
    }

    if (data.step === "text") {
      data.text = text;
      
      try {
        const audioPath = await downloadFile(data.audioFileId, `audio_${Date.now()}.mp3`);
        const photoPath = await downloadFile(data.photoFileId, `photo_${Date.now()}.jpg`);

        const songs = loadSongs();
        songs.push({
          name: data.name,
          category: data.category,
          audio: audioPath,
          image: photoPath,
          text: data.text
        });

        saveSongs(songs);
        ctx.reply("✅ Qo'shiq muvaffaqiyatli qo'shildi!");
      } catch (error) {
        console.error(error);
        ctx.reply("❌ Xatolik yuz berdi, qayta urinib ko'ring.");
      } finally {
        delete addingSong[user];
      }
      return;
    }
  }

  // Kategoriyani tanlash
  const songs = loadSongs();
  const categorySongs = songs.filter(song => song.category === text);

  if (categorySongs.length > 0) {
    const songButtons = categorySongs.map(song => [
      Markup.button.callback(`${song.name}`, `song_${song.name}`)
    ]);
    ctx.reply(
      "🎵 Ushbu kategoriyadagi qo‘shiqlar:",
      Markup.inlineKeyboard(songButtons)
    );
  } else {
    ctx.reply("❌ Bu kategoriyada qo‘shiqlar topilmadi.");
  }
});

// Qo'shiqni tanlash
bot.action(/song_(.+)/, async (ctx) => {
  const songName = ctx.match[1];
  const songs = loadSongs();
  const song = songs.find(s => s.name === songName);

  if (song) {
    try {
      // Rasm va audio yuborish
      await ctx.replyWithPhoto({ source: song.image }, { caption: `🎵 ${song.name}` });
      await ctx.replyWithAudio(
        { source: song.audio },
        {
          caption: "Qo‘shiqni tinglang!",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("📝 Matnni olish", `text_${song.name}`)]
          ]).reply_markup
        }
      );
    } catch (error) {
      console.error(error);
      ctx.reply("❌ Xatolik yuz berdi, qayta urinib ko‘ring.");
    }
  } else {
    ctx.reply("❌ Qo'shiq topilmadi.");
  }
});

// Qo'shiq matnini yuborish
bot.action(/text_(.+)/, async (ctx) => {
  const songName = ctx.match[1];
  const songs = loadSongs();
  const song = songs.find(s => s.name === songName);

  if (song) {
    await ctx.reply(`📝 *${song.name}* qo‘shiq matni:\n\n${song.text}`, { parse_mode: "Markdown" });
  } else {
    ctx.reply("❌ Qo'shiq matni topilmadi.");
  }
});

bot.launch();

console.log("Bot ishga tushdi...");