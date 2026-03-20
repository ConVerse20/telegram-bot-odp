const TelegramBot = require('node-telegram-bot-api')
const axios = require('axios')
const csv = require('csv-parser')
const { Readable } = require('stream')
const { google } = require('googleapis')

// ========= CONFIG (ENV) =========
const TOKEN = process.env.BOT_TOKEN
const SHEET_URL = process.env.ODP_SHEET
const SHEET_ID = process.env.SHEET_ID
const KEY_FILE = './service-account.json'
const RADAR_RADIUS = 50

const ADMIN_IDS = String(process.env.ADMIN_IDS || '167474430')
  .split(',')
  .map(x => Number(x.trim()))

// ========= RESET TELEGRAM (FIX 409) =========
(async () => {
  try {
    console.log('♻️ Reset session Telegram...')
    await axios.get(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`)
    await axios.get(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=-1`)
    console.log('✅ Session bersih')
  } catch (e) {
    console.log('⚠️ Reset gagal:', e.message)
  }
})()

// ========= BOT =========
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 }
  }
})

console.log("🚀 BOT ODP PREMIUM AKTIF")

let sheetData = []
let userMode = {}
let pendingApproval = {}

// ========= GOOGLE SHEETS =========
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
})
const sheets = google.sheets({version:'v4', auth})

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

  // ===== VALDAT ISI =====
  if(data.startsWith('VALDAT_ISI|')){
    const nama = data.split('|')[1]
    userMode[chatId] = { valdat:true, field:'VALDAT_ISI', nama }
    bot.sendMessage(chatId,'Masukkan isi pelanggan / daftar port')
    return
  }

  // ===== APPROVE =====
  if(data.startsWith('APPROVE_')){
    const id=data.split('_')[1]
    const p=pendingApproval[id]
    if(!p) return

    try{
      const colLetter=String.fromCharCode(64+p.col)

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
      bot.sendMessage(chatId,"❌ Gagal update sheet")
    }
    return
  }

  // ===== REJECT =====
  if(data.startsWith('REJECT_')){
    const id = data.split('_')[1]
    const p = pendingApproval[id]
    if(!p) return

    bot.sendMessage(p.userChatId,
`❌ VALDAT DITOLAK ADMIN

ODP: ${p.nama}
Field: ${p.field.replace('VALDAT_','')}
Nilai: ${p.value}`)

    bot.sendMessage(chatId,"❌ Update ditolak")
    delete pendingApproval[id]
    return
  }

  // ===== MENU =====
  if(data==='VALIDASI'){
    userMode[chatId]='VALIDASI'
    bot.sendMessage(chatId,"Ketik nama ODP")
    return
  }

  if(data==='RADAR'){
    userMode[chatId]='RADAR'
    bot.sendMessage(chatId,"Share lokasi")
    return
  }

  if(data==='STATUS_MENU'){
    userMode[chatId]='STATUS'
    bot.sendMessage(chatId,"Pilih status",{
      reply_markup:{
        inline_keyboard:[
          [{text:'🟢 GREEN',callback_data:'STATUS_GREEN'}],
          [{text:'🟡 YELLOW',callback_data:'STATUS_YELLOW'}],
          [{text:'🔴 RED',callback_data:'STATUS_RED'}],
          [{text:'⚫ BLACK',callback_data:'STATUS_BLACK'}]
        ]
      }
    })
    return
  }

  if(data.startsWith('STATUS_')){
    await loadSheet()
    const s = data.replace('STATUS_','')
    const filtered = sheetData.filter(o=>o.status===s)

    for(const o of filtered){
      await bot.sendMessage(chatId, formatODPWithValdat(o), {reply_markup:valdatKeyboard(o)})
      await bot.sendLocation(chatId,o.lat,o.lon)
    }
    return
  }

  if(data.startsWith('VALDAT_')){
    const [field, nama] = data.split('|')
    userMode[chatId] = { valdat:true, field, nama }

    if(field === 'VALDAT_ISI'){
      bot.sendMessage(chatId,'Masukkan isi pelanggan / daftar port')
    } else {
      bot.sendMessage(chatId,'Masukkan nilai baru')
    }
    return
  }

})

// ========= LOCATION =========
bot.on('location', async msg=>{
  const chatId = msg.chat.id
  if(userMode[chatId]!=='RADAR') return
  await loadSheet()
  const {latitude, longitude} = msg.location
  sendRadar(chatId, latitude, longitude)
})

// ========= RADAR =========
async function sendRadar(chatId, lat, lon){
  const nearby = sheetData
    .map(o=>({...o, jarak: distance(lat,lon,o.lat,o.lon)}))
    .filter(o=>o.jarak <= RADAR_RADIUS)
    .sort((a,b)=>a.jarak-b.jarak)

  if(!nearby.length) return bot.sendMessage(chatId,"❌ Tidak ada ODP dalam radius 50m")

  for(let i=0;i<nearby.length;i++){
    const o = nearby[i]
    await bot.sendMessage(chatId, `*${i+1}. ODP TERDEKAT (${Math.round(o.jarak)}m)*`, {parse_mode:'Markdown'})
    await bot.sendMessage(chatId, formatODPWithValdat(o), {reply_markup:valdatKeyboard(o)})
    await bot.sendLocation(chatId,o.lat,o.lon)
  }
}

// ========= MESSAGE =========
bot.on('message', async msg=>{
  if(!msg.text) return
  const chatId = msg.chat.id
  if(msg.text.startsWith('/')) return

  // ===== VALDAT INPUT =====
  if(userMode[chatId]?.valdat){
    const {field,nama}=userMode[chatId]
    await loadSheet()

    const odp = sheetData.find(o=>o.nama===nama)
    if(!odp) return bot.sendMessage(chatId,"❌ ODP tidak ditemukan")

    const colMap={ GPON:5, SLOT:6, PORT:7, ISI:8 }
    const col=colMap[field.replace('VALDAT_','')]
    if(!col) return bot.sendMessage(chatId,"❌ Field tidak valid")

    const approvalId=Date.now()

    pendingApproval[approvalId]={
      nama, field, value:msg.text, col,
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

  // ===== VALIDASI =====
  if(userMode[chatId]==='VALIDASI'){
    await loadSheet()
    const found = sheetData.find(o=>o.nama.toLowerCase()===msg.text.toLowerCase())
    if(!found) return bot.sendMessage(chatId,"❌ ODP tidak ditemukan")

    await bot.sendMessage(chatId, formatODPWithValdat(found), {reply_markup:valdatKeyboard(found)})
    await bot.sendLocation(chatId,found.lat,found.lon)
    return
  }

})
