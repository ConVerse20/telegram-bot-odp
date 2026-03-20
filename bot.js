const TelegramBot = require('node-telegram-bot-api')
const axios = require('axios')
const csv = require('csv-parser')
const { Readable } = require('stream')
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

console.log('🚀 BOT OPERASIONAL AKTIF')
console.log('Menunggu perintah user...')

// ===== CONFIG =====
const AUTO_REPORT_CHAT = -1003710120558   // isi chat id admin / grup
const TOKEN = '8591485951:AAHdgFvcOiOmcef73mjxuwuDil-rMxdlBhs'
const SHEET_PSB = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRT8WvAoQf8mC30wQHDfKoPUxM22MAaBXYMxS4gzLZwG7a3oSj16OccUs1d8pzUY6SIriE3J_7T6C-u/pub?gid=1126007031&single=true&output=csv'
const SHEET_GGN = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRT8WvAoQf8mC30wQHDfKoPUxM22MAaBXYMxS4gzLZwG7a3oSj16OccUs1d8pzUY6SIriE3J_7T6C-u/pub?gid=1813473768&single=true&output=csv'

const bot = new TelegramBot(TOKEN,{polling:true})

let dataPSB=[]
let dataGGN=[]
let userMode={}
const albums = {}; // tangible album
const tangibleODP = {}; // simpan nama ODP per user

// ===== LOAD CSV =====
async function loadCSV(url){
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
}

// ===== FORMAT WAKTU SEKARANG =====
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

  bot.sendMessage(AUTO_REPORT_CHAT, text, {
    message_thread_id: 0
  })
}
 // <<< WAJIB ADA





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
        [{text:'📈 Grafik Bulan Ini',callback_data:'GRAFIK_PSB'}], // TAMBAH
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

  console.log('User klik:', d)
  
  if(d === 'TEST_AUTO'){
  await autoReportPSB()
  return bot.sendMessage(id,'✅ Auto Report dijalankan manual')
}

  await refreshData()

  if(d==='MAIN') return mainMenu(id)
if(d==='PSB') return menuPSB(id)
if(d==='GGN') return menuGGN(id)

if(d==='TANGIBLE'){
  userMode[id] = 'INPUT_ODP'
  return bot.sendMessage(id,
`🖼️ INPUT TANGGIBLE

Silakan masukkan NAMA ODP terlebih dahulu.`);
}


  function menuGGN(id){
  bot.sendMessage(id,'🚧 GANGGUAN',{
    reply_markup:{inline_keyboard:[
      [{text:'🔎 Search WO',callback_data:'S_GGN'}],
      [{text:'📊 Jumlah WO Hari Ini',callback_data:'J_GGN'}],
      [{text:'📉 Sisa WO',callback_data:'SISA_GGN'}],
      [{text:'📋 Detail WO Hari Ini',callback_data:'DETAIL_GGN'}],
      [{text:'👷 Performa Teknisi',callback_data:'PERF_TEKNISI'}],
      [{text:'🏠 Menu Utama',callback_data:'MAIN'}]
    ]}
  })
}



  if(d==='S_PSB'){ userMode[id]='S_PSB'; return bot.sendMessage(id,'Masukkan SC / Track ID') }
  if(d==='S_GGN'){ userMode[id]='S_GGN'; return bot.sendMessage(id,'Masukkan No Ticket') }
// ===== MENU PERFORMA TEKNISI =====
if(d === 'PERF_TEKNISI'){
  return bot.sendMessage(id,'👷 PERFORMA TEKNISI',{
    reply_markup:{
      inline_keyboard:[
        [{text:'📅 Performa Harian',callback_data:'PERF_HARIAN'}],
        [{text:'📅 Performa Bulan Berjalan',callback_data:'PERF_BULAN'}],
        [{text:'🔙 Kembali',callback_data:'GGN'}]
      ]
    }
  })
}


// ===== PERFORMA HARIAN =====
if(d === 'PERF_HARIAN'){

  const data = hitungPerforma(dataGGN,'harian')
  const tabel = formatTabel(data)

  return bot.sendMessage(id,
`👷 PERFORMA TEKNISI HARI INI

\`\`\`
${tabel}
\`\`\``,
{parse_mode:'Markdown'})
}


// ===== PERFORMA BULAN =====
if(d === 'PERF_BULAN'){

  const data = hitungPerforma(dataGGN,'bulan')
  const tabel = formatTabel(data)

  return bot.sendMessage(id,
`👷 PERFORMA TEKNISI BULAN BERJALAN

\`\`\`
${tabel}
\`\`\``,
{parse_mode:'Markdown'})
}
  // ================= GRAFIK PSB =================
if(d==='GRAFIK_PSB'){

  const now   = new Date()
  const bulanIndex = now.getMonth()
  const bulan = String(bulanIndex+1).padStart(2,'0')
  const tahun = now.getFullYear()

  const namaBulan = [
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'
  ]

  const bulanData = dataPSB.filter(r =>
    r[0] && r[0].includes(`/${bulan}/${tahun}`)
  )

  const counter = {}

  bulanData.forEach(r=>{
    const status = (r[13] || 'UNKNOWN').toUpperCase()
    counter[status] = (counter[status] || 0) + 1
  })

  let text = `📈 *GRAFIK PSB ${namaBulan[bulanIndex]} ${tahun}*\n\n`

  Object.entries(counter).forEach(([status,total])=>{
    const bar = '█'.repeat(total > 30 ? 30 : total) // biar ga kepanjangan
    text += `${status.padEnd(18)} : ${bar} ${total}\n`
  })

  if(!Object.keys(counter).length){
    text += 'Tidak ada data bulan ini'
  }

  // kirim grafik
  await bot.sendMessage(id, text, {parse_mode:'Markdown'})

  // kirim tombol detail
  return bot.sendMessage(id,'📋 Detail Kendala Bulan Ini:',{
    reply_markup:{
      inline_keyboard:[
        [{text:'⚠️ Kendala Teknik',callback_data:'DET_TEKNIK'}],
        [{text:'🚧 Kendala Non Teknik',callback_data:'DET_NONTEK'}]
      ]
    }
  })
}
if(d==='DET_NONTEK'){
  const now   = new Date()
  const bulan = String(now.getMonth()+1).padStart(2,'0')
  const tahun = now.getFullYear()

  const list = dataPSB.filter(r =>
    r[0] &&
    r[0].includes(`/${bulan}/${tahun}`) &&
    (r[13] || '').toLowerCase().includes('non')
  )

  if(!list.length){
    return bot.sendMessage(id,'Tidak ada Kendala Non Teknik bulan ini')
  }

  let text='🚧 *DETAIL KENDALA NON TEKNIK*\n\n'

  list.forEach((r,i)=>{
    text+=
`🧾 ORDER ${i+1}
━━━━━━━━━━━━━━━━━━
🔢 No SC       : ${r[4] || '-'}
🌐 Internet    : ${r[5] || '-'}
👤 Nama        : ${r[9] || '-'}
📞 CP          : ${r[11] || '-'}
📦 Paket       : ${r[12] || '-'}
📌 Status      : ${r[13] || '-'}
👷 Teknisi     : ${r[17] || '-'}
⚠️ Detail Kendala : ${r[16] || '-'}

━━━━━━━━━━━━━━━━━━\n\n`
  })

  return bot.sendMessage(id,text,{parse_mode:'Markdown'})
}
if(d==='DET_TEKNIK'){
  const now   = new Date()
  const bulan = String(now.getMonth()+1).padStart(2,'0')
  const tahun = now.getFullYear()

  const list = dataPSB.filter(r =>
    r[0] &&
    r[0].includes(`/${bulan}/${tahun}`) &&
    (r[13] || '').toLowerCase().includes('teknik') &&
    !(r[13] || '').toLowerCase().includes('non')
  )

  if(!list.length){
    return bot.sendMessage(id,'Tidak ada Kendala Teknik bulan ini')
  }

  let text='⚠️ *DETAIL KENDALA TEKNIK*\n\n'

  list.forEach((r,i)=>{
    text+=
`🧾 ORDER ${i+1}
━━━━━━━━━━━━━━━━━━
🔢 No SC       : ${r[4] || '-'}
🌐 Internet    : ${r[5] || '-'}
👤 Nama        : ${r[9] || '-'}
📞 CP          : ${r[11] || '-'}
📦 Paket       : ${r[12] || '-'}
📌 Status      : ${r[13] || '-'}
👷 Teknisi     : ${r[17] || '-'}
⚠️ Detail Kendala : ${r[16] || '-'}

━━━━━━━━━━━━━━━━━━\n\n`
  })

  return bot.sendMessage(id,text,{parse_mode:'Markdown'})
}


    

  // ================= JUMLAH PSB HARI INI =================
  if(d==='J_PSB'){

    const now = new Date()
    const today =
      String(now.getDate()).padStart(2,'0') + '/' +
      String(now.getMonth()+1).padStart(2,'0') + '/' +
      now.getFullYear()

    const list = dataPSB.filter(r => r[0] && r[0].includes(today))

    const { tanggal, jam } = getNow()

let text =
`📊 *TOTAL PSB HARI INI : ${list.length}*
🗓️ Tanggal : ${tanggal}
⏰ Jam      : ${jam}

`


    list.forEach((r,i)=>{

  const statusRaw = (r[13] || '').toLowerCase()
  const detailKendala = (r[16] || '').trim()   // KOLOM Q

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
`🧾 *ORDER ${i+1}*
━━━━━━━━━━━━━━━━━━
🔢 No SC       : ${r[4] || '-'}
🌐 Internet    : ${r[5] || '-'}
👤 Nama        : ${r[9] || '-'}
📞 CP          : ${r[11] || '-'}
📦 Paket       : ${r[12] || '-'}
📌 Status      : ${r[13] || '-'}
👷 Teknisi     : ${r[17] || '-'}${kendalaText}

━━━━━━━━━━━━━━━━━━\n\n`
})


    return bot.sendMessage(id, text, {parse_mode:'Markdown'})
  }

  // ================= GANGGUAN =================
  if(d==='J_GGN'){
    const now = new Date()
    const today =
      String(now.getDate()).padStart(2,'0')+'/' +
      String(now.getMonth()+1).padStart(2,'0')+'/' +
      now.getFullYear()

    const total = dataGGN.filter(r=>r[0] && r[0].includes(today)).length
    return bot.sendMessage(id,`Total Gangguan Hari Ini: ${total}`)
  }

  if(d==='SISA_GGN'){
    const sisa = dataGGN.filter(r=>!r[13]).length
    return bot.sendMessage(id,`Sisa WO: ${sisa}`)
  }
})


// ===== MESSAGE HANDLER =====
bot.on('message', async msg => {
  if(!msg.text) return
  if(msg.text.startsWith('/')) return

  const id = msg.chat.id
  const mode = userMode[id]
  const input = msg.text.toUpperCase().trim()

  await refreshData()
  
// ===== INPUT NAMA ODP =====
if(mode === 'INPUT_ODP'){

  tangibleODP[id] = msg.text.trim();

  userMode[id] = 'TANGIBLE';

  return bot.sendMessage(id,
`📍 Nama ODP: ${tangibleODP[id]}

Sekarang kirim 6 foto (boleh satu-satu / forward).`);
}

  // ===== SEARCH PSB =====
if(mode === 'S_PSB'){

  const keyword = input.replace(/\s/g,'')

  const r = dataPSB.find(x=>{
    if(!x[4]) return false
    const sc = x[4].toUpperCase().replace(/\s/g,'')
    return sc.includes(keyword)
  })

  userMode[id] = null

  if(!r){
    return bot.sendMessage(id,'❌ SC / Track ID tidak ditemukan')
  }

  // KOLOM A - M JADI 1 BARIS TAB
  const hasil = r.slice(0,13).join('\t')

  return bot.sendMessage(id, hasil)
}



  // ===== SEARCH GGN =====
  if(mode === 'S_GGN'){

    const r = dataGGN.find(x =>
      x[3] && x[3].toUpperCase().includes(input)
    )

    if(!r){
      userMode[id] = null
      return bot.sendMessage(id,'❌ Ticket tidak ditemukan')
    }

    bot.sendMessage(id,
`Ticket : ${r[3]}
Customer : ${r[1]}
Status : ${r[14] || '-'}`)

    userMode[id] = null
  }
})

// ===== INPUT TANGGIBLE FLEXIBLE =====
bot.on("photo", async (msg) => {

  const chatId = msg.chat.id;
  const mode = userMode[chatId];

  if (mode !== "TANGIBLE") return;

  if (!albums[chatId]) {
    albums[chatId] = [];
  }

  const photo = msg.photo[msg.photo.length - 1];

  albums[chatId].push(photo.file_id);

  bot.sendMessage(chatId,
    `📸 Foto diterima (${albums[chatId].length}/6)`
  );

  if (albums[chatId].length === 6) {

    await processAlbum(chatId, albums[chatId]);

    delete albums[chatId];
    userMode[chatId] = null;
    delete tangibleODP[chatId];
  }
});


// ===== PROCESS ALBUM =====
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


// ===== MERGE IMAGE =====
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
      .rotate() // auto rotate dari kamera HP
      .resize(W, H, {
        fit: "contain",
        position: "center",
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


// ===== PERFORMA TEKNISI ENGINE =====

function hitungPerforma(data, mode){

  const now = new Date()

  const today =
    String(now.getDate()).padStart(2,'0') + '/' +
    String(now.getMonth()+1).padStart(2,'0') + '/' +
    now.getFullYear()

  const bulan =
    '/' + String(now.getMonth()+1).padStart(2,'0') + '/' +
    now.getFullYear()

  const teknisi = {}

  data.forEach(r=>{

    const tgl = r[0] || ''
    const nama = (r[8] || 'UNKNOWN').toUpperCase()
    const status = (r[15] || '').toLowerCase()

    if(!status.includes('CLOSED')) return

    if(mode==='harian' && !tgl.includes(today)) return
    if(mode==='bulan' && !tgl.includes(bulan)) return

    if(!teknisi[nama]){
      teknisi[nama] = {
        CLOSE:0,
        LPS:0,
        SQM:0,
        DM:0,
        PLTNM:0,
        GOLD:0,
        FFG:0,
        REG:0
      }
    }

    teknisi[nama].CLOSE++

    const cust = (r[1] || '').toUpperCase()
    const ticket = (r[3] || '').toUpperCase()
    const summary = (r[4] || '').toUpperCase()

    if(ticket.includes('LAPSUNG')){
      teknisi[nama].LPS++
    }
    else if(summary.includes('[SQM]')){
      teknisi[nama].SQM++
    }
    else if(cust === 'HVC_DIAMOND'){
      teknisi[nama].DM++
    }
    else if(cust === 'HVC_PLATINUM'){
      teknisi[nama].PLTNM++
    }
    else if(cust === 'HVC_GOLD'){
      teknisi[nama].GOLD++
    }
    else if(cust === 'FFG_60 HARI'){
      teknisi[nama].FFG++
    }
    else{
      teknisi[nama].REG++
    }

  })

  return teknisi
}



function formatTabel(data){

  let text = `
TEKNISI                 CLOSE  LPS  SQM  DM  PLTNM  GOLD  FFG  REG  TOTAL
-----------------------------------------------------------------------
`

  Object.entries(data)
  .sort((a,b)=>b[1].CLOSE-a[1].CLOSE)
  .forEach(([nama,v])=>{

    const total =
      v.LPS +
      v.SQM +
      v.DM +
      v.PLTNM +
      v.GOLD +
      v.FFG +
      v.REG

    text +=
`${nama.padEnd(22)} ${String(v.CLOSE).padStart(5)} ${String(v.LPS).padStart(5)} ${String(v.SQM).padStart(5)} ${String(v.DM).padStart(4)} ${String(v.PLTNM).padStart(6)} ${String(v.GOLD).padStart(5)} ${String(v.FFG).padStart(5)} ${String(v.REG).padStart(5)} ${String(total).padStart(6)}
`

  })

  return text
}








