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

// ========= CONFIG (PAKAI ENV) =========
const TOKEN = process.env.BOT_TOKEN
const SHEET_URL = process.env.ODP_SHEET
const SHEET_ID = process.env.SHEET_ID

// ========= ADMIN IDS FIX =========
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
  polling: {
    autoStart: false,
    params: { timeout: 10 }
  }
})

bot.startPolling()

bot.on("polling_error", (err) => {
  console.log("Polling error:", err.message)
})

console.log("🚀 BOT ODP PREMIUM AKTIF")

// ========= STATE =========
let sheetData = []
let userMode = {}
let pendingApproval = {}

// ========= GOOGLE AUTH (FIX RAILWAY) =========
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})
const sheets = google.sheets({ version: 'v4', auth })

// ========= STATUS ICON =========
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

// ========= DISTANCE =========
function distance(lat1, lon1, lat2, lon2){
  const R = 6371000
  const toRad = d=>d*Math.PI/180
  const dLat = toRad(lat2-lat1)
  const dLon = toRad(lon2-lon1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2
  return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)))
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

  // ===== APPROVE =====
  if(data.startsWith('APPROVE_')){
    const id=data.split('_')[1]
    const p=pendingApproval[id]
    if(!p) return

    try{
      const colLetter = String.fromCharCode(64 + Number(p.col))

      console.log("UPDATE:", `ODP!${colLetter}${p.row}`, p.value)

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

  // ===== VALIDASI =====
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

  // ===== VALDAT =====
  if(userMode[chatId]?.valdat){
    const {field,nama}=userMode[chatId]
    await loadSheet()

    const odp = sheetData.find(o=>o.nama===nama)
    if(!odp) return bot.sendMessage(chatId,"❌ ODP tidak ditemukan")

    const colMap={ GPON:5, SLOT:6, PORT:7, ISI:8 }
    const col=colMap[field.replace('VALDAT_','')]

    const approvalId=Date.now()

    pendingApproval[approvalId]={
      nama,
      field,
      value:msg.text,
      col,
      row:odp.row,
      user:msg.from.username || msg.from.first_name,
      userChatId:chatId
    }

    ADMIN_IDS.forEach(adminId=>{
      console.log("Kirim ke admin:", adminId)

      bot.sendMessage(adminId,
`📝 PERMINTAAN UPDATE ODP

ODP: ${nama}
Field: ${field.replace('VALDAT_','')}
Nilai: ${msg.text}
User: @${pendingApproval[approvalId].user}`,
{
  reply_markup:{
    inline_keyboard:[
      [
        {text:'✅ APPROVE',callback_data:`APPROVE_${approvalId}`},
        {text:'❌ REJECT',callback_data:`REJECT_${approvalId}`}
      ]
    ]
  }
})
    })

    bot.sendMessage(chatId,"⏳ Menunggu approval admin...")
    userMode[chatId]=null
    return
  }
})
