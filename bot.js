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
const bot = new TelegramBot(TOKEN, {
  polling: false
})

// 🔥 FIX 409 TOTAL
async function startBot() {
  try {
    await bot.deleteWebHook()
    console.log("✅ Webhook dihapus")

    await bot.startPolling({
      restart: true,
      dropPendingUpdates: true
    })

    console.log("🚀 BOT ODP PREMIUM AKTIF")
  } catch (err) {
    console.log("START ERROR:", err.message)
  }
}

startBot()

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

// 🔥 FIX WAJIB
const sheets = google.sheets({ version: 'v4', auth })

// ========= STATUS =========
const STATUS_ICON = { RED:'🔴', YELLOW:'🟡', GREEN:'🟢', BLACK:'⚫' }

// ========= LOAD SHEET =========
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

function formatODPWithValdat(o){
  const incomplete = ['#N/A', undefined, null]
  let text = formatODP(o)
  if(incomplete.includes(o.gpon) || incomplete.includes(o.slot) || incomplete.includes(o.port)){
    text += `\n⚠️ Data belum lengkap, silakan VALDAT ulang.`
  }
  return text
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
  bot.sendMessage(chatId,"✅ Bot siap!",{reply_markup:{remove_keyboard:true}})
  showMenu(chatId)
})

// ========= CALLBACK =========
bot.on('callback_query', async q => {
  bot.answerCallbackQuery(q.id)
  const chatId = q.message.chat.id
  const data = q.data

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

  if(data==='VALIDASI'){
    userMode[chatId]='VALIDASI'
    bot.sendMessage(chatId,"Ketik nama ODP")
    return
  }
})

// ========= MESSAGE =========
bot.on('message', async msg=>{
  if(!msg.text) return
  const chatId = msg.chat.id
  if(msg.text.startsWith('/')) return

  if(userMode[chatId]==='VALIDASI'){
    await loadSheet()

    const odp = sheetData.find(o=>o.nama===msg.text)
    if(!odp) return bot.sendMessage(chatId,"❌ ODP tidak ditemukan")

    bot.sendMessage(chatId, formatODPWithValdat(odp), {
      reply_markup: valdatKeyboard(odp)
    })
  }
})
