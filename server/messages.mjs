// Server-side text that people read outside the app (SMS, official receipts). English and Kiswahili.
export const LANGS = ['en', 'sw'];
export const normLang = (l) => (LANGS.includes(l) ? l : 'en');

const ksh = (n) => 'KSh ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const when = (at) => new Date(at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });

export const otpSms = (lang, code) => normLang(lang) === 'sw'
  ? `Nambari yako ya Church Connect ni ${code}. Inaisha baada ya dakika 10. Usimpe mtu yeyote.`
  : `Your Church Connect code is ${code}. It expires in 10 minutes. Do not share it.`;

export const receiptSms = (lang, { receiptNo, church, amount, memberName, mpesaCode, parts }) => normLang(lang) === 'sw'
  ? `${receiptNo}: ${church} imepokea ${ksh(amount)} kutoka kwa ${memberName} (M-Pesa ${mpesaCode}). ${parts}. Asante, Mungu akubariki.`
  : `${receiptNo}: ${church} received ${ksh(amount)} from ${memberName} (M-Pesa ${mpesaCode}). ${parts}. Thank you, God bless you.`;

export const roleSms = (lang, ok, roleName) => normLang(lang) === 'sw'
  ? (ok ? `Nafasi yako ya ${roleName} imethibitishwa. Fungua Church Connect kuona dashibodi yako.` : `Ombi lako la ${roleName} halikukubaliwa. Tafadhali zungumza na Katibu wa Kanisa.`)
  : (ok ? `Your position as ${roleName} has been verified. Open Church Connect to see your dashboard.` : `Your request for ${roleName} was not approved. Please speak to the Church Secretary.`);

export function receiptText(lang, p, no, church, by, at) {
  if (normLang(lang) === 'sw') return ['RISITI RASMI  ' + no, church, 'Tarehe: ' + when(at), '', 'Imepokelewa kutoka kwa: ' + p.memberName, 'Jina la M-Pesa: ' + p.mpesaName, 'Nambari ya M-Pesa: ' + p.mpesaCode, 'Kusudi: ' + p.purpose, '', 'Mgawanyo:', ...p.allocations.map((a) => `  ${a.category} (${a.percent}%): ${ksh(a.amount)}`), 'Jumla: ' + ksh(p.amount), '', by ? `Imepokelewa na: ${by} (Mweka Hazina wa Kanisa)` : 'Imethibitishwa kiotomatiki dhidi ya rekodi ya M-Pesa, kwa Mweka Hazina wa Kanisa', 'Asante. Mungu akubariki.'].join('\n');
  return ['OFFICIAL RECEIPT  ' + no, church, 'Date: ' + when(at), '', 'Received from: ' + p.memberName, 'M-Pesa name: ' + p.mpesaName, 'M-Pesa code: ' + p.mpesaCode, 'Purpose: ' + p.purpose, '', 'Breakdown:', ...p.allocations.map((a) => `  ${a.category} (${a.percent}%): ${ksh(a.amount)}`), 'Total: ' + ksh(p.amount), '', by ? `Received by: ${by} (Church Treasurer)` : 'Confirmed automatically against the M-Pesa record, for the Church Treasurer', 'Thank you. God bless you.'].join('\n');
}

// ---- Error messages shown to church members, leaders and Church Admins. The English text is the key.
// (The developer console is for the app developers and stays in English.)
export const reqLang = (req) => normLang(String((req && req.headers && req.headers['x-lang']) || '').slice(0, 5).toLowerCase());

const SERVER_SW = {
  'Bad payload.': 'Taarifa zilizotumwa si sahihi.',
  'Choose a month like 2026-10.': 'Chagua mwezi kama 2026-10.',
  'Choose a valid year.': 'Chagua mwaka sahihi.',
  'You are not allowed to see this.': 'Huruhusiwi kuona hili.',
  "M-Pesa checking is not switched on, so payments cannot be confirmed in bulk.": "Ukaguzi wa M-Pesa haujawashwa, kwa hivyo malipo hayawezi kuthibitishwa kwa pamoja.",
  "Choose a valid date range.": "Chagua kipindi sahihi cha tarehe.",
  "Only the Secretary or Clerk keep the membership roll.": "Ni Katibu au Karani tu wanaotunza orodha ya wanachama.",
  "Applications are decided by the Church Board.": "Maombi huamuliwa na Bodi ya Kanisa.",
  "Already that status.": "Tayari ina hali hiyo.",
  "Write the church they are moving to.": "Andika kanisa wanalohamia.",
  "Only the Secretary, Clerk or Pastor can issue letters.": "Ni Katibu, Karani au Mchungaji tu wanaoweza kutoa barua.",
  "Choose a letter type.": "Chagua aina ya barua.",
  "This person has no baptism date on record.": "Mtu huyu hana tarehe ya ubatizo kwenye rekodi.",
  "Only a member on the roll can have a letter of membership.": "Ni mshiriki aliye kwenye orodha tu anayeweza kupewa barua ya uanachama.",
  "Only a member on the roll can be transferred.": "Ni mshiriki aliye kwenye orodha tu anayeweza kuhamishwa.",
  "Choose a status.": "Chagua hali.",
  'Only the Pastor and the Church Board can see this report.': 'Ni Mchungaji na Bodi ya Kanisa tu wanaoweza kuona ripoti hii.',
  'Code expired. Ask for a new one.': 'Nambari imeisha muda. Omba mpya.',
  'Enter a valid Kenyan phone number.': 'Weka nambari sahihi ya simu ya Kenya.',
  'Enter your church number. Your church administrator can tell you what it is.': 'Weka nambari ya kanisa lako. Msimamizi wa kanisa anaweza kukueleza ni ipi.',
  'Invalid phone number.': 'Nambari ya simu si sahihi.',
  'Message is too long (2000 characters).': 'Ujumbe ni mrefu mno (herufi 2000).',
  'New account: send profile with name and idNumber.': 'Akaunti mpya: tuma wasifu wenye jina na nambari ya kitambulisho.',
  'Paste the sermon text (at least a few sentences).': 'Bandika maandishi ya mahubiri (angalau sentensi chache).',
  'Please state the purpose of payment.': 'Tafadhali andika kusudi la malipo.',
  'Say which church you are transferring from.': 'Andika unahama kutoka kanisa gani.',
  'The M-Pesa code must be 10 letters/digits.': 'Nambari ya M-Pesa lazima iwe herufi/tarakimu 10.',
  'Title and message are required.': 'Kichwa na ujumbe vinahitajika.',
  'Unknown role.': 'Nafasi haijulikani.',
  'Write a message first.': 'Andika ujumbe kwanza.',
  'Write the member\'s name.': 'Andika jina la mshiriki.',
  'Invalid JSON.': 'Taarifa zilizotumwa si sahihi.',
  'The upload was interrupted. Please try again.': 'Upakiaji umekatizwa. Tafadhali jaribu tena.',
  'Wrong code.': 'Nambari si sahihi.',
  'Please sign in.': 'Tafadhali ingia.',
  'Only the Church Admin can do this.': 'Ni Msimamizi wa Kanisa tu anayeweza kufanya hivi.',
  'Only the Church Treasurer can confirm payments.': 'Ni Mweka Hazina wa Kanisa tu anayeweza kuthibitisha malipo.',
  'Only the Pastor, Secretary or Elders can create sermon summaries.': 'Ni Mchungaji, Katibu au Wazee tu wanaoweza kutengeneza muhtasari wa mahubiri.',
  'Only the Secretary or Pastor can archive an account.': 'Ni Katibu au Mchungaji tu anayeweza kuhifadhi akaunti kwenye kumbukumbu.',
  'Only the Secretary, Pastor or Church Admin can read the audit trail.': 'Ni Katibu, Mchungaji au Msimamizi wa Kanisa tu wanaoweza kusoma kumbukumbu za ukaguzi.',
  'Only the Secretary, Pastor or Church Admin verifies leader roles.': 'Ni Katibu, Mchungaji au Msimamizi wa Kanisa tu wanaothibitisha nafasi za viongozi.',
  'Only the Treasurer or Pastor can see this report.': 'Ni Mweka Hazina au Mchungaji tu wanaoweza kuona ripoti hii.',
  'Only the Treasurer or Pastor can see this.': 'Ni Mweka Hazina au Mchungaji tu wanaoweza kuona hili.',
  'Only the group leader approves group posts.': 'Ni kiongozi wa kikundi tu anayeidhinisha machapisho ya kikundi.',
  'This account is archived. Contact the Church Secretary or Church Admin.': 'Akaunti hii imehifadhiwa kwenye kumbukumbu. Wasiliana na Katibu wa Kanisa au Msimamizi wa Kanisa.',
  'Transfers are decided by the Church Board, led by the Pastor.': 'Uhamisho huamuliwa na Bodi ya Kanisa, inayoongozwa na Mchungaji.',
  'You are not allowed to add this.': 'Huruhusiwi kuongeza hili.',
  'You are not allowed to archive this.': 'Huruhusiwi kuhifadhi hili kwenye kumbukumbu.',
  'You are not allowed to restore this.': 'Huruhusiwi kurejesha hili.',
  'You can only see your own statement.': 'Unaweza kuona taarifa yako mwenyewe tu.',
  'You cannot approve your own role.': 'Huwezi kuidhinisha nafasi yako mwenyewe.',
  'You cannot archive your own account.': 'Huwezi kuhifadhi akaunti yako mwenyewe.',
  'You cannot change your own role.': 'Huwezi kubadilisha nafasi yako mwenyewe.',
  'Waiting for the church admin to approve you.': 'Unasubiri Msimamizi wa Kanisa akuidhinishe.',
  'Church not found.': 'Kanisa halikupatikana.',
  'Member not found.': 'Mshiriki hakupatikana.',
  'No archived member found.': 'Hakuna mshiriki aliyehifadhiwa aliyepatikana.',
  'No such member.': 'Mshiriki huyo hayupo.',
  'No such user.': 'Mtumiaji huyo hayupo.',
  'Not found.': 'Haipatikani.',
  'Payment not found.': 'Malipo hayakupatikana.',
  'That church number was not found. Check it with your church secretary.': 'Nambari hiyo ya kanisa haikupatikana. Ithibitishe na katibu wa kanisa lako.',
  'That church number was not found.': 'Nambari hiyo ya kanisa haikupatikana.',
  'Unknown collection.': 'Kundi la rekodi halijulikani.',
  'A Church Admin must ask the app developer to appoint a new admin before moving.': 'Msimamizi wa Kanisa lazima amwombe msanidi programu ateue msimamizi mpya kabla ya kuhama.',
  'Already active.': 'Tayari yuko hai.',
  'Already archived.': 'Tayari imehifadhiwa kwenye kumbukumbu.',
  'Already decided.': 'Tayari imeamuliwa.',
  'Already published.': 'Tayari imechapishwa.',
  'That M-Pesa code was already submitted.': 'Nambari hiyo ya M-Pesa ilishawasilishwa.',
  'That person has since joined a church, so they cannot be restored here.': 'Mtu huyo ameshajiunga na kanisa, kwa hivyo hawezi kurejeshwa hapa.',
  'That phone already belongs to another church. The person must move (or be archived there) first.': 'Simu hiyo tayari iko kanisa lingine. Mtu huyo lazima ahame (au ahifadhiwe huko) kwanza.',
  'This job is not in a failed state.': 'Kazi hii haijashindwa.',
  'This payment was already received.': 'Malipo haya tayari yalipokelewa.',
  'This person is not waiting for approval.': 'Mtu huyu hasubiri idhini.',
  'You already belong to this church.': 'Tayari wewe ni mshiriki wa kanisa hili.',
  'You already have an application waiting for the Church Board.': 'Tayari una ombi linalosubiri Bodi ya Kanisa.',
  'The recording is too large.': 'Rekodi ni kubwa mno.',
  'Too large.': 'Ni kubwa mno.',
  'The recording file is missing. Please record or upload again.': 'Faili ya rekodi haipo. Tafadhali rekodi au pakia tena.',
  'The sermon text is too long to summarise.': 'Maandishi ya mahubiri ni marefu mno kufupishwa.',
  'The recording is empty.': 'Rekodi haina kitu.',
  'Please wait a minute before asking for another code.': 'Tafadhali subiri dakika moja kabla ya kuomba nambari nyingine.',
  'Several sermons are already being processed. Please wait a few minutes.': 'Mahubiri kadhaa yanashughulikiwa. Tafadhali subiri dakika chache.',
  'Slow down.': 'Polepole.',
  'Too many attempts. Please try again later.': 'Majaribio mengi mno. Tafadhali jaribu tena baadaye.',
  'Too many requests. Please try again later.': 'Maombi mengi mno. Tafadhali jaribu tena baadaye.',
  'Too many wrong attempts. Ask for a new code.': 'Majaribio mengi yasiyo sahihi. Omba nambari mpya.',
  'You are sending too many messages. Please wait a little.': 'Unatuma ujumbe mwingi mno. Tafadhali subiri kidogo.',
  'We could not send the SMS code. Please try again in a few minutes.': 'Hatukuweza kutuma SMS ya nambari. Tafadhali jaribu tena baada ya dakika chache.',
  'The summary service is not set up yet. Please ask the church administrator.': 'Huduma ya muhtasari bado haijawekwa. Tafadhali muulize msimamizi wa kanisa.',
  'Something went wrong on the server.': 'Hitilafu imetokea kwenye seva.',
  'Not found': 'Haipatikani.',
  'Archive only: nothing in this system can be deleted. Use the archive action.': 'Kuhifadhi tu: hakuna kinachofutwa kwenye mfumo huu. Tumia kitendo cha kuhifadhi.',
  'Records are changed only through specific actions.': 'Rekodi hubadilishwa kupitia vitendo maalum tu.',
  'Something went wrong while summarising. Please try again.': 'Hitilafu imetokea wakati wa kufupisha. Tafadhali jaribu tena.',
  'Ready': 'Tayari',
  'Choose the Sabbath date.': 'Chagua tarehe ya Sabato.',
  'Add at least one class.': 'Ongeza darasa angalau moja.',
  'Each class needs a name, the number on the roll and the number present.': 'Kila darasa linahitaji jina, idadi iliyo kwenye orodha na idadi waliohudhuria.',
  'Visitors must be a number.': 'Wageni lazima iwe nambari.',
  'Attendance for that Sabbath is already recorded. Archive it first to record it again.': 'Mahudhurio ya Sabato hiyo tayari yamerekodiwa. Yahifadhi kwenye kumbukumbu kwanza ili kurekodi tena.',
  'Write the name and the amount pledged.': 'Andika jina na kiasi cha ahadi.',
  'Choose a valid due date.': 'Chagua tarehe sahihi ya mwisho.',
  'Pledge not found.': 'Ahadi haikupatikana.',
  'Enter the amount paid.': 'Weka kiasi kilicholipwa.',
  'Choose a valid date.': 'Chagua tarehe sahihi.',
  'Days must be a number from 1 to 30.': 'Siku lazima iwe nambari kuanzia 1 hadi 30.',
  'Write the name of the person registering.': 'Andika jina la anayejisajili.',
  'This person is already registered for this camp meeting.': 'Mtu huyu tayari amesajiliwa kwa mkutano huu wa kambi.',
  'Only the camp meeting officers can do this.': 'Ni maafisa wa mkutano wa kambi tu wanaoweza kufanya hivi.',
  'Enter the fee.': 'Weka ada.',
  'The file needs a first row with column names (Name, Phone, Role...) and at least one member.': 'Faili inahitaji safu ya kwanza yenye majina ya nguzo (Name, Phone, Role...) na mshiriki mmoja angalau.',
  'The first row must have a Name column and a Phone column.': 'Safu ya kwanza lazima iwe na nguzo ya Name na nguzo ya Phone.',
  'Please import at most 500 people at a time.': 'Tafadhali ingiza watu 500 tu kwa wakati mmoja.',
  'This phone number appears twice in the file.': 'Nambari hii ya simu inaonekana mara mbili kwenye faili.',
  'That person is already a member of this church.': 'Mtu huyo tayari ni mshiriki wa kanisa hili.',
  'That number is reserved.': 'Nambari hiyo imehifadhiwa.',
};
export const errText = (lang, msg) => (normLang(lang) === 'sw' && SERVER_SW[msg]) || msg;
export const hasSw = (msg) => msg in SERVER_SW;

// ---- Push notification texts
export const pushText = (lang, kind, a = {}) => {
  const sw = normLang(lang) === 'sw';
  switch (kind) {
    case 'receipt': return sw ? { title: 'Risiti yako', body: `${a.receiptNo}: ${a.church} imepokea ${ksh(a.amount)}. Asante, Mungu akubariki.` } : { title: 'Your receipt', body: `${a.receiptNo}: ${a.church} received ${ksh(a.amount)}. Thank you, God bless you.` };
    case 'notice': { const g = a.groupKey && GROUP_NAMES[a.groupKey]; const nm = g ? g[sw ? 1 : 0] + ' – ' : ''; const bd = a.board === 'church' ? ['Church Notice Board', 'Ubao wa Matangazo wa Kanisa'] : a.board === 'camp' ? ['Camp Meeting Board', 'Ubao wa Mkutano wa Kambi'] : ['Group board', 'Ubao wa kikundi']; return { title: nm + bd[sw ? 1 : 0], body: a.title }; }
    case 'approval': return sw ? { title: 'Chapisho linasubiri idhini', body: a.title } : { title: 'A post is waiting for your approval', body: a.title };
    case 'chat_admin': return sw ? { title: 'Jibu kutoka kwa msanidi programu', body: a.text } : { title: 'Reply from the app developer', body: a.text };
    case 'role': return sw ? { title: 'Nafasi yako', body: a.ok ? 'Nafasi yako imethibitishwa.' : 'Ombi lako la nafasi halikukubaliwa.' } : { title: 'Your position', body: a.ok ? 'Your position has been verified.' : 'Your request was not approved.' };
    case 'join': return sw ? { title: 'Karibu!', body: `Umekubaliwa kujiunga na ${a.church}.` } : { title: 'Welcome!', body: `You have been let in to ${a.church}.` };
    case 'payment': return sw ? { title: 'Malipo mapya', body: `${a.name}: ${ksh(a.amount)}` } : { title: 'New payment to confirm', body: `${a.name}: ${ksh(a.amount)}` };
    case 'remind_payments': return sw ? { title: 'Malipo yanasubiri', body: `Malipo ${a.n} yanasubiri kuthibitishwa kwa zaidi ya siku ${a.days}.` } : { title: 'Payments are waiting', body: `${a.n} payment(s) have waited more than ${a.days} days to be confirmed.` };
    case 'remind_joins': return sw ? { title: 'Watu wanasubiri kuruhusiwa', body: `Watu ${a.n} wamesubiri kuruhusiwa kwa zaidi ya siku ${a.days}.` } : { title: 'People are waiting to join', body: `${a.n} person(s) have waited more than ${a.days} days to be let in.` };
    case 'remind_roles': return sw ? { title: 'Nafasi zinasubiri uthibitisho', body: `Nafasi ${a.n} za uongozi zinasubiri kuthibitishwa kwa zaidi ya siku ${a.days}.` } : { title: 'Positions need verifying', body: `${a.n} leader position(s) have waited more than ${a.days} days.` };
    case 'remind_transfers': return sw ? { title: 'Maombi ya uhamisho yanasubiri', body: `Maombi ${a.n} ya uhamisho yanasubiri Bodi ya Kanisa kwa zaidi ya siku ${a.days}.` } : { title: 'Transfer applications are waiting', body: `${a.n} application(s) have waited for the Church Board more than ${a.days} days.` };
    default: return { title: 'Church Connect', body: '' };
  }
};

export const ROLE_NAMES = {
 "dorcas": [
  "Dorcas",
  "Dorkasi"
 ],
 "men": [
  "Adventist Men",
  "Wanaume wa Kiadventista"
 ],
 "youth": [
  "Adventist Youth",
  "Vijana wa Kiadventista"
 ],
 "pathfinders": [
  "Pathfinders",
  "Watafuta Njia (Pathfinders)"
 ],
 "adventurers": [
  "Adventurers",
  "Adventurers (Watoto wadogo)"
 ],
 "choir": [
  "Church Choir",
  "Kwaya ya Kanisa"
 ],
 "pastor": [
  "Pastor (Pastor's Office)",
  "Mchungaji (Ofisi ya Mchungaji)"
 ],
 "treasurer": [
  "Church Treasurer",
  "Mweka Hazina wa Kanisa"
 ],
 "secretary": [
  "Church Secretary",
  "Katibu wa Kanisa"
 ],
 "clerk": [
  "Church Clerk",
  "Karani wa Kanisa"
 ],
 "sabbath_school": [
  "Sabbath School Department",
  "Idara ya Shule ya Sabato"
 ],
 "education": [
  "Education Department",
  "Idara ya Elimu"
 ],
 "elder1": [
  "Church Elder 1",
  "Mzee wa Kanisa 1"
 ],
 "elder2": [
  "Church Elder 2",
  "Mzee wa Kanisa 2"
 ],
 "elder3": [
  "Church Elder 3",
  "Mzee wa Kanisa 3"
 ],
 "elder4": [
  "Church Elder 4",
  "Mzee wa Kanisa 4"
 ],
 "camp_secretary": [
  "Camp Meeting Secretary",
  "Katibu wa Mkutano wa Kambi"
 ],
 "camp_chair": [
  "Camp Meeting Chairperson",
  "Mwenyekiti wa Mkutano wa Kambi"
 ],
 "camp_clerk": [
  "Camp Meeting Clerk",
  "Karani wa Mkutano wa Kambi"
 ],
 "building": [
  "Building Committee",
  "Kamati ya Ujenzi"
 ],
 "special": [
  "Special Groups and Occasions",
  "Vikundi Maalum na Matukio"
 ],
 "dorcas_leader": [
  "Dorcas Leader",
  "Kiongozi wa Dorkasi"
 ],
 "men_leader": [
  "Adventist Men Leader",
  "Kiongozi wa Wanaume wa Kiadventista"
 ],
 "youth_leader": [
  "Adventist Youth Leader",
  "Kiongozi wa Vijana wa Kiadventista"
 ],
 "pathfinder_leader": [
  "Pathfinder Director",
  "Mkurugenzi wa Watafuta Njia"
 ],
 "adventurer_leader": [
  "Adventurer Director",
  "Mkurugenzi wa Adventurers"
 ],
 "choir_leader": [
  "Church Choir Director",
  "Mkurugenzi wa Kwaya ya Kanisa"
 ],
 "church_admin": [
  "Church Admin",
  "Msimamizi wa Kanisa"
 ]
};
export const roleName = (key, lang) => { const r = ROLE_NAMES[key]; return r ? r[normLang(lang) === 'sw' ? 1 : 0] : key; };

export const GROUP_NAMES = {"dorcas": ["Dorcas", "Dorkasi"], "men": ["Adventist Men", "Wanaume wa Kiadventista"], "youth": ["Adventist Youth", "Vijana wa Kiadventista"], "pathfinders": ["Pathfinders", "Watafuta Njia (Pathfinders)"], "adventurers": ["Adventurers", "Adventurers (Watoto wadogo)"], "choir": ["Church Choir", "Kwaya ya Kanisa"]};
