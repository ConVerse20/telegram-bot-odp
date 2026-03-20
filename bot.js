const TelegramBot = require('node-telegram-bot-api')
const axios = require('axios')
const csv = require('csv-parser')
const { Readable } = require('stream')
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

console.log('🚀 BOT OPERASIONAL AKTIF')
console.log('Menunggu perintah user...')

// ===== CONFIG (ENV) =====
const TOKEN = process.env.BOT_TOKEN
const AUTO_REPORT_CHAT = process.env.AUTO_REPORT_CHAT
const SHEET_PSB = process.env.SHEET_PSB
const SHEET_GGN = process.env.SHEET_GGN
const SHEET_ODP = process.env.ODP_SHEET

if (!TOKEN) {
  console.log('❌ BOT_TOKEN tidak ditemukan di ENV')
  process.exit(1)
}

const bot = new TelegramBot(TOKEN,{polling:true})

let dataPSB=[]
let dataGGN=[]
let dataODP=[] // TAMBAHAN
let userMode={}
const albums = {};
const tangibleODP = {};

// ===== LOAD CSV =====
async function loadCSV(url){
  if(!url) return []
  const res = await axios.get(url)
  const rows=[]
  return new Promise(resolve=>{
    Readable.from(res.data)
      .pipe(csv())
      .on('data',row=>{
        const v=Object.values(row)
        if(!v[0]) return
        if(v[0].includes('Tanggal')||v[0].includes('TGL')) return
        rows.push(v)
      })
      .on('end',()=>resolve(rows))
  })
}

async function refreshData(){
  dataPSB=await loadCSV(SHEET_PSB)
  dataGGN=await loadCSV(SHEET_GGN)
  dataODP=await loadCSV(SHEET_ODP) // TAMBAHAN
}

// ===== FORMAT WAKTU =====
function getNow(){
  const now = new Date()
  const tanggal =
    String(now.getDate()).padStart(2,'0') + '/' +
    String(now.getMonth()+1).padStart(2,'0') + '/' +
    now.getFullYear()

  const jam =
    String(now.getHours()).padStart(2,'0') + ':' +
    String(now.getMinutes()).padStart(2,'0')

  return { tanggal, jam }
}

// ===== AUTO REPORT =====
async function autoReportPSB(){
  await refreshData()
  const { tanggal, jam } = getNow()
  const list = dataPSB.filter(r => r[0] && r[0].includes(tanggal))
  if(list.length === 0) return

  let text =
`📊 TOTAL PSB HARI INI : ${list.length}
🗓️ Tanggal : ${tanggal}
⏰ Jam      : ${jam}

`

  list.forEach((r,i)=>{
    const statusRaw = (r[13] || '').toLowerCase()
    const detailKendala = (r[16] || '').trim()

    let kendalaText = ''

    if(
      statusRaw.includes('kendala') &&
      detailKendala &&
      detailKendala !== '-' &&
      detailKendala !== '#N/A'
    ){
      kendalaText = `\n⚠️ Detail Kendala : ${detailKendala}`
    }

    text +=
`🧾 ORDER ${i+1}
━━━━━━━━━━━━━━━━━━
🔢 No SC       : ${r[4] || '-'}
🌐 Internet    : ${r[5] || '-'}
👤 Nama        : ${r[9] || '-'}
📞 CP          : ${r[11] || '-'}
📦 Paket       : ${r[12] || '-'}
📌 Status      : ${r[13] || '-'}
👷 Teknisi     : ${r[17] || '-'}${kendalaText}

━━━━━━━━━━━━━━━━━━

`
  })

  bot.sendMessage(AUTO_REPORT_CHAT, text)
}

// ===== MENU =====
function mainMenu(id){
  bot.sendMessage(id,'🤖 BOT OPERASIONAL',{
    reply_markup:{inline_keyboard:[
      [{text:'🆕 PASANG BARU',callback_data:'PSB'}],
      [{text:'🚧 GANGGUAN',callback_data:'GGN'}],
      [{text:'🖼️ INPUT TANGGIBLE',callback_data:'TANGIBLE'}],
      [{text:'🧪 Test Auto Report',callback_data:'TEST_AUTO'}]
    ]}
  })
}

function menuPSB(id){
  bot.sendMessage(id,'🆕 PASANG BARU',{
    reply_markup:{
      inline_keyboard:[
        [{text:'🔎 Search WO',callback_data:'S_PSB'}],
        [{text:'📊 Jumlah WO Hari Ini',callback_data:'J_PSB'}],
        [{text:'📈 Grafik Bulan Ini',callback_data:'GRAFIK_PSB'}],
        [{text:'📌 Status WO',callback_data:'ST_PSB'}],
        [{text:'⚠️ Kendala',callback_data:'K_PSB'}],
        [{text:'🏠 Menu Utama',callback_data:'MAIN'}]
      ]
    }
  })
}

// ===== START =====
bot.onText(/\/start/,msg=>mainMenu(msg.chat.id))

// ===== CALLBACK =====
bot.on('callback_query', async q=>{
  bot.answerCallbackQuery(q.id)
  const id = q.message.chat.id
  const d  = q.data

  if(d === 'TEST_AUTO'){
    await autoReportPSB()
    return bot.sendMessage(id,'✅ Auto Report dijalankan manual')
  }

  await refreshData()

  if(d==='MAIN') return mainMenu(id)
  if(d==='PSB') return menuPSB(id)

  if(d==='TANGIBLE'){
    userMode[id] = 'INPUT_ODP'
    return bot.sendMessage(id,'🖼️ INPUT TANGGIBLE\n\nSilakan masukkan NAMA ODP terlebih dahulu.')
  }

})

// ===== MESSAGE =====
bot.on('message', async msg => {
  if(!msg.text) return
  if(msg.text.startsWith('/')) return

  const id = msg.chat.id
  const mode = userMode[id]

  await refreshData()

  if(mode === 'INPUT_ODP'){
    tangibleODP[id] = msg.text.trim();
    userMode[id] = 'TANGIBLE';
    return bot.sendMessage(id,`📍 Nama ODP: ${tangibleODP[id]}\n\nSekarang kirim 6 foto.`);
  }
})

// ===== PHOTO =====
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const mode = userMode[chatId];
  if (mode !== "TANGIBLE") return;

  if (!albums[chatId]) albums[chatId] = [];

  const photo = msg.photo[msg.photo.length - 1];
  albums[chatId].push(photo.file_id);

  if (albums[chatId].length === 6) {
    await processAlbum(chatId, albums[chatId]);
    delete albums[chatId];
    userMode[chatId] = null;
    delete tangibleODP[chatId];
  }
});

// ===== PROCESS =====
async function processAlbum(chatId, fileIds) {
  try {
    const tempFiles = [];

    for (let i = 0; i < fileIds.length; i++) {
      const file = await bot.getFile(fileIds[i]);
      const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
      const res = await axios.get(url, { responseType: "arraybuffer" });

      const filename = `temp_${Date.now()}_${i}.jpg`;
      fs.writeFileSync(filename, res.data);
      tempFiles.push(filename);
    }

    const resultFile = await mergeImages(tempFiles);

    await bot.sendPhoto(chatId, fs.createReadStream(resultFile), {
      caption: `🖼️ INPUT TANGGIBLE ${tangibleODP[chatId] || '-'} BERHASIL`
    });

    setTimeout(()=>{
      tempFiles.forEach(f => fs.unlinkSync(f));
      fs.unlinkSync(resultFile);
    }, 3000);

  } catch (err) {
    console.log(err);
    bot.sendMessage(chatId, "❌ Gagal menggabungkan foto.");
  }
}

// ===== MERGE =====
async function mergeImages(images) {
  const W = 600;
  const H = 600;
  const GAP = 20;

  const base = sharp({
    create: {
      width: (W * 3) + (GAP * 4),
      height: (H * 2) + (GAP * 3),
      channels: 3,
      background: { r: 245, g: 245, b: 245 }
    }
  });

  const composites = [];

  for (let i = 0; i < images.length; i++) {
    const img = await sharp(images[i])
      .rotate()
      .resize(W, H, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255 }
      })
      .toBuffer();

    composites.push({
      input: img,
      left: (i % 3) * (W + GAP) + GAP,
      top: Math.floor(i / 3) * (H + GAP) + GAP
    });
  }

  const output = `hasil_${Date.now()}.jpg`;

  await base
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(output);

  return output;
}
