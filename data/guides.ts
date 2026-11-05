// First-run guides: what each role does in the app, shown once on first sign-in (and any time from "How this works").
// The text is English; Kiswahili is in sw.ts, keyed by the same English text.
export interface GuideStep { icon: string; title: string; body: string }
export interface Guide { title: string; steps: GuideStep[] }

const GUIDES: Record<string, Guide> = {
  member: { title: "Welcome to your church app", steps: [
    { icon: "💳", title: "Give by M-Pesa", body: "Pay to your church Pay Bill, then open Give and send the M-Pesa code, the name on M-Pesa, the purpose and how the amount is split. The Treasurer confirms it and your receipt arrives here." },
    { icon: "🧾", title: "Your receipts and statement", body: "My Receipts keeps every receipt. Giving Statement shows what you gave in a year, ready to print or share." },
    { icon: "📢", title: "Notice boards", body: "Read the church board and the camp meeting board. Your groups have their own boards where you can post; the group leader approves your post first." },
    { icon: "🙏", title: "Pastoral Care", body: "Listen to daily and weekly messages from the Pastor and read the sermon summaries, including a children's version." },
    { icon: "🌍", title: "Language and moving church", body: "Use the EN | SW switch at the top to change language. If you move to another church, use Change church with that church's number." },
  ] },
  former_leader: { title: "Your advisory role", steps: [
    { icon: "🧭", title: "Advisors help", body: "Former leaders advise and assist. There is no absolute retirement: your experience still serves the church." },
    { icon: "👀", title: "What you can read", body: "You can read records and notice boards, and see welfare and the building project." },
    { icon: "💳", title: "Give and receive care", body: "Giving, your receipts and Pastoral Care work exactly as for every member." },
  ] },
  church_admin: { title: "You run this church's page", steps: [
    { icon: "🔢", title: "Your church number", body: "The Church Admin page shows your special church number. Members type it when they sign up or move to your church." },
    { icon: "👥", title: "Members", body: "Let in people who joined, add members yourself, change positions and archive members. Archiving is how you \"delete\": it can always be undone." },
    { icon: "📥", title: "Many members at once", body: "Export and import lets you add a whole list from a spreadsheet and print a directory." },
    { icon: "✅", title: "Verify leader positions", body: "When someone asks to be Treasurer or another leader, you or the Secretary check it. Until then they act as members." },
    { icon: "💬", title: "Talk to the app developer", body: "The chat button gives you a direct line to the app developer team. A number shows when there is a new reply." },
  ] },
  treasurer: { title: "Your Treasurer dashboard", steps: [
    { icon: "📥", title: "Payments Inbox", body: "Payments that members report appear here. When the money is on the Pay Bill, tap Received and the member's receipt is sent automatically." },
    { icon: "🔎", title: "M-Pesa checking", body: "Payments that reached the Pay Bill but nobody has reported appear as unclaimed. A check mark means M-Pesa itself confirmed the amount." },
    { icon: "🧮", title: "The split", body: "Each payment is divided as the member chose (tithe, offering, building and so on). Welfare and Building shares are posted for you." },
    { icon: "📊", title: "Monthly report", body: "Open Monthly Report to get the month's totals as a spreadsheet. Giving statements for members are there too." },
  ] },
  secretary: { title: "Your Secretary dashboard", steps: [
    { icon: "✅", title: "Verify leader positions", body: "People who ask for a leader position act as members until you or the Pastor approve. Check with the church first." },
    { icon: "🗂️", title: "Membership", body: "Record members by baptism or transfer. Transfer applications go to the Church Board, led by the Pastor, to decide." },
    { icon: "📜", title: "Minute Vault", body: "Keep the minutes of every meeting here. Minutes are never deleted; mistakes are archived and re-entered." },
    { icon: "📢", title: "Church notice board", body: "Leaders post here and only you archive old notices." },
  ] },
  clerk: { title: "Your Clerk dashboard", steps: [
    { icon: "🗂️", title: "Membership records", body: "You keep the membership list together with the Secretary: baptisms and transfers." },
    { icon: "📄", title: "Office records", body: "Use Office Records for correspondence and registers. Each entry is dated and kept." },
    { icon: "📢", title: "Boards and activities", body: "Post to the church board and plan activities." },
  ] },
  pastor: { title: "Your Pastor dashboard", steps: [
    { icon: "🏛️", title: "Church Board decisions", body: "Transfer applications wait for you. Approve or decline, and the member gets their number." },
    { icon: "✅", title: "Verify positions", body: "You can verify leader positions together with the Secretary." },
    { icon: "🎙️", title: "Sermon recorder", body: "Record the sermon and stop: the quick, full and children's summaries appear in Pastoral Care after a few minutes." },
    { icon: "💬", title: "Pastoral Care messages", body: "Post a daily or weekly message. Members can listen to it read aloud." },
    { icon: "📊", title: "Overview", body: "You can read payments, welfare, attendance, pledges and camp registrations to care for the whole church." },
  ] },
  sabbath_school: { title: "Your Sabbath School dashboard", steps: [
    { icon: "📝", title: "Attendance register", body: "Each Sabbath, record every class: how many are on the roll and how many came, plus visitors and the lesson. The classes are remembered for next week." },
    { icon: "🗓️", title: "Activities", body: "Plan Sabbath School programs and events on the calendar." },
    { icon: "🔁", title: "Correcting a record", body: "One record per Sabbath. To correct it, archive it and record again. Nothing is deleted." },
  ] },
  education: { title: "Your Education dashboard", steps: [
    { icon: "📄", title: "Office records", body: "Keep education plans, reports and registers in Office Records." },
    { icon: "🗓️", title: "Activities", body: "Plan education events and invite the church through the notice board." },
  ] },
  elder: { title: "Your Elder dashboard", steps: [
    { icon: "🤝", title: "Support the Pastor", body: "Elders assist the Pastor in spiritual care and oversight of the church." },
    { icon: "🎙️", title: "Sermon summaries", body: "You can record a sermon and create its summaries, just as the Pastor can." },
    { icon: "📢", title: "Boards and activities", body: "Post to the church board and plan activities." },
  ] },
  camp: { title: "Your Camp Meeting dashboard", steps: [
    { icon: "📢", title: "Camp Meeting board", body: "Camp officers and the Pastor post here for the whole church." },
    { icon: "🎟️", title: "Registration", body: "Members register themselves. You can register others, set the fee, record payments and check people in on arrival." },
    { icon: "🗓️", title: "Activities", body: "Plan camp programs on the calendar." },
  ] },
  building: { title: "Your Building Committee dashboard", steps: [
    { icon: "🏗️", title: "Building project", body: "Record contributions and spending for the Church Building project. Members' building gifts are posted automatically when the Treasurer confirms them." },
    { icon: "🤲", title: "Pledges", body: "Record what each person has promised and add payments as they come. The balance and overdue pledges show at a glance." },
  ] },
  special: { title: "Your Special Groups dashboard", steps: [
    { icon: "🗓️", title: "Plan occasions", body: "Plan special groups and occasions on the calendar." },
    { icon: "📄", title: "Office records", body: "Keep plans, reports and registers in Office Records." },
  ] },
  group_leader: { title: "Your group dashboard", steps: [
    { icon: "📢", title: "Your group board", body: "Post freely to your group board. Other members' posts wait for your approval." },
    { icon: "✅", title: "Approve posts", body: "Open the group board to approve or archive posts. Nothing is ever deleted." },
    { icon: "🗓️", title: "Activities and members", body: "Plan group activities and see who belongs to the group." },
  ] },
};

/** Which guide a role gets. Roles with no guide of their own get the most useful general one. */
export const guideKeyFor = (role: string): string => {
  if (GUIDES[role]) return role;
  if (/^elder\d$/.test(role)) return 'elder';
  if (/^camp_/.test(role)) return 'camp';
  if (/_leader$/.test(role)) return 'group_leader';
  return 'member';
};
export const guideFor = (role: string): Guide => GUIDES[guideKeyFor(role)];
