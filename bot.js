// ===== ANTI DOUBLE INSTANCE =====
if (global.botRunning) {
  console.log("⚠️ Bot sudah jalan, skip instance baru")
  process.exit(0)
}
global.botRunning = true

process.env.NTBA_FIX_350 = 1

// ========= IMPORT =========
const TelegramBot = require('node-telegram-bot-api')
const axios = require('axios')
const csv = require('csv-parser')
const { Readable } = require('stream')
const { google } = require('googleapis')

// ========= CONFIG =========
const TOKEN = process.env.BOT_TOKEN
const SHEET_URL = process.env.ODP_SHEET
const SHEET_ID = process.env.SHEET_ID

// ========= ADMIN =========
const rawAdmin = process.env.ADMIN_IDS
let ADMIN_IDS = []

if (!rawAdmin) {
  ADMIN_IDS = [167474430]
} else {
  ADMIN_IDS = rawAdmin
    .replace(/"/g, '')
    .split(',')
    .map(x => Number(x.trim()))
    .filter(x => !isNaN(x))
}

// ========= BOT INIT =========
const bot = new TelegramBot(TOKEN, { polling: false })

async function initBot() {
  await bot.deleteWebHook({ drop_pending_updates: true })
  await new Promise(r => setTimeout(r, 1500))
  await bot.startPolling({ restart: true })
  console.log("🚀 BOT ODP PREMIUM AKTIF")
}
initBot()

bot.on("polling_error", (err) => {
  console.log("Polling error:", err.message)
})

// ========= STATE =========
let sheetData = []
let userMode = {}
let pendingApproval = {}

// ========= GOOGLE AUTH =========
const credentials = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDS_BASE64, 'base64').toString('utf-8')
)

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})

const sheets = google.sheets({ version: 'v4', auth })

// ========= STATUS =========
const STATUS_ICON = { RED:'🔴', YELLOW:'🟡', GREEN:'🟢', BLACK:'⚫' }

// ========= LOAD =========
async function loadSheet(){
  sheetData=[]
  const res = await axios.get(SHEET_URL)

  let rowNumber=2

  return new Promise(resolve=>{
    Readable.from(res.data)
    .pipe(csv())
    .on('data',row=>{
      const k=Object.keys(row)
      const nama=row[k[0]]?.trim()
      const status=row[k[2]]?.trim()
      const share=row[k[3]]?.trim()
      const gpon=row[k[4]]?.trim()
      const slot=row[k[5]]?.trim()
      const port=row[k[6]]?.trim()
      const isi=row[k[7]]?.trim()

      if(!nama || !share){ rowNumber++; return }

      const coord=share.match(/-?\d+\.\d+/g)
      if(!coord){ rowNumber++; return }

      sheetData.push({
        nama,status,gpon,slot,port,isi,
        lat:parseFloat(coord[0]),
        lon:parseFloat(coord[1]),
        row:rowNumber
      })

      rowNumber++
    })
    .on('end',resolve)
  })
}

// ========= FORMAT =========
function formatODP(o){
  return `━━━━━━━━━━━━━━
✅ ODP SUDAH GOLEP
━━━━━━━━━━━━━━
📡 ${o.nama}
${STATUS_ICON[o.status] || '⚪'} Status : ${o.status}
🌐 GPON   : ${o.gpon}
🎯 SLOT   : ${o.slot}
🔌 Port   : ${o.port}
📋 Isi Pelanggan :
${o.isi || '-'}
━━━━━━━━━━━━━━`
}

function valdatKeyboard(o){
  return {
    inline_keyboard:[
      [
        {text:'📝 VALDAT GPON', callback_data:`VALDAT_GPON|${o.nama}`},
        {text:'📝 VALDAT SLOT', callback_data:`VALDAT_SLOT|${o.nama}`},
        {text:'📝 VALDAT PORT', callback_data:`VALDAT_PORT|${o.nama}`}
      ],
      [
        {text:'📋 VALDAT ISI PELANGGAN', callback_data:`VALDAT_ISI|${o.nama}`}
      ]
    ]
  }
}

// ========= MENU =========
function showMenu(chatId){
  bot.sendMessage(chatId,
`🤖 *BOT VALIDASI ODP*

Silakan pilih menu.`,
  {
    parse_mode:'Markdown',
    reply_markup:{
      inline_keyboard:[
        [{text:'✅ Validasi ODP',callback_data:'VALIDASI'}],
        [{text:'📡 Cek ODP Terdekat',callback_data:'RADAR'}],
        [{text:'🔍 Search ODP by Status',callback_data:'STATUS_MENU'}]
      ]
    }
  })
}

// ========= START =========
bot.onText(/\/start/, msg=>{
  const chatId = msg.chat.id
  userMode[chatId] = null
  bot.sendMessage(chatId,"✅ Bot siap!")
  showMenu(chatId)
})

// ========= CALLBACK =========
bot.on('callback_query', async q => {
  bot.answerCallbackQuery(q.id)
  const chatId = q.message.chat.id
  const data = q.data

  // ===== VALDAT CLICK =====
  if(data.startsWith('VALDAT_')){
    const [field,nama] = data.split('|')

    userMode[chatId] = {
      valdat:true,
      field,
      nama
    }

    bot.sendMessage(chatId,`Masukkan nilai ${field.replace('VALDAT_','')}`)
    return
  }

  // ===== APPROVE =====
  if(data.startsWith('APPROVE_')){
    const id=data.split('_')[1]
    const p=pendingApproval[id]
    if(!p) return

    try{
      const colLetter = String.fromCharCode(64 + Number(p.col))

      await sheets.spreadsheets.values.update({
        spreadsheetId:SHEET_ID,
        range:`ODP!${colLetter}${p.row}`,
        valueInputOption:'RAW',
        requestBody:{ values:[[p.value]] }
      })

      await loadSheet()

      bot.sendMessage(chatId,"✅ Update disetujui & data diperbarui")

      bot.sendMessage(p.userChatId,
`✅ VALDAT DISETUJUI ADMIN

ODP: ${p.nama}
Field: ${p.field.replace('VALDAT_','')}
Nilai: ${p.value}`)

      delete pendingApproval[id]

    }catch(err){
      console.log("ERROR GSHEET:", err.response?.data || err.message)
      bot.sendMessage(chatId,"❌ Gagal update sheet")
    }
    return
  }

  // ===== REJECT (FIX) =====
  if(data.startsWith('REJECT_')){
    const id = data.split('_')[1]
    const p = pendingApproval[id]
    if(!p) return

    bot.sendMessage(chatId,"❌ Update ditolak")

    bot.sendMessage(p.userChatId,
`❌ VALDAT DITOLAK ADMIN

ODP: ${p.nama}
Field: ${p.field.replace('VALDAT_','')}
Nilai: ${p.value}`)

    delete pendingApproval[id]
    return
  }

  if(data==='VALIDASI'){
    userMode[chatId]='VALIDASI'
    bot.sendMessage(chatId,"Ketik nama ODP")
    return
  }

  // ===== RADAR (FIX SHARELOK) =====
  if(data==='RADAR'){
    userMode[chatId]='RADAR'
    bot.sendMessage(chatId,"📍 Kirim lokasi kamu (share location)")
    return
  }
})

// ========= MESSAGE =========
bot.on('message', async msg=>{
  if(!msg.text && !msg.location) return
  const chatId = msg.chat.id
  if(msg.text && msg.text.startsWith('/')) return

  // ===== SHARE LOCATION (FIX) =====
  if(msg.location && userMode[chatId]==='RADAR'){
    const userLat = msg.location.latitude
    const userLon = msg.location.longitude

    await loadSheet()

    let nearest = null
    let minDist = Infinity

    function distance(a,b,c,d){
      const R = 6371
      const dLat = (c-a)*Math.PI/180
      const dLon = (d-b)*Math.PI/180
      const x = Math.sin(dLat/2)**2 +
        Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*
        Math.sin(dLon/2)**2
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
    }

    sheetData.forEach(o=>{
      const dist = distance(userLat,userLon,o.lat,o.lon)
      if(dist < minDist){
        minDist = dist
        nearest = o
      }
    })

    if(!nearest){
      bot.sendMessage(chatId,"❌ ODP tidak ditemukan")
      return
    }

    bot.sendMessage(chatId, formatODP(nearest), {
      reply_markup: valdatKeyboard(nearest)
    })

    bot.sendLocation(chatId, nearest.lat, nearest.lon)

    userMode[chatId]=null
    return
  }

  // ===== INPUT VALDAT =====
  if(userMode[chatId]?.valdat){
    const {field,nama}=userMode[chatId]
    await loadSheet()

    const odp = sheetData.find(o=>o.nama===nama)
    if(!odp) return bot.sendMessage(chatId,"❌ ODP tidak ditemukan")

    const colMap={ GPON:5, SLOT:6, PORT:7, ISI:8 }
    const col=colMap[field.replace('VALDAT_','')]

    const id=Date.now()

    pendingApproval[id]={
      nama,
      field,
      value:msg.text,
      col,
      row:odp.row,
      user:msg.from.username || msg.from.first_name,
      userChatId:chatId
    }

    ADMIN_IDS.forEach(adminId=>{
      bot.sendMessage(adminId,
`📝 PERMINTAAN UPDATE ODP

ODP: ${nama}
Field: ${field.replace('VALDAT_','')}
Nilai: ${msg.text}
User: @${pendingApproval[id].user}`,
{
  reply_markup:{
    inline_keyboard:[
      [
        {text:'✅ APPROVE',callback_data:`APPROVE_${id}`},
        {text:'❌ REJECT',callback_data:`REJECT_${id}`}
      ]
    ]
  }
})
    })

    bot.sendMessage(chatId,"⏳ Menunggu approval admin...")
    userMode[chatId]=null
    return
  }

  // ===== SEARCH ODP =====
  if(userMode[chatId]==='VALIDASI'){
    await loadSheet()
    const odp = sheetData.find(o=>o.nama===msg.text)

    if(!odp) return bot.sendMessage(chatId,"❌ ODP tidak ditemukan")

    bot.sendMessage(chatId, formatODP(odp), {
      reply_markup: valdatKeyboard(odp)
    })
  }
})
