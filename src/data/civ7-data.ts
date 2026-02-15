import type { CivMeta, LeaderMeta } from "./index.js";
  /* production bot data */
// export const CIV7_LEADERS = Object.freeze({
//   LEADER_ADA_LOVELACE: { gameId: "Ada_Lovelace", emojiId: "1464705360970645504", type: "None" },
//   LEADER_AMINA: { gameId: "Amina", emojiId: "1464705362446913607", type: "None" },
//   LEADER_ASHOKA: { gameId: "Ashoka_World_Renouncer", emojiId: "1464705365706018918", type: "None" },
//   LEADER_ASHOKA_ALT: { gameId: "Ashoka_World_Conqueror", emojiId: "1464705363948343489", type: "None" },
//   LEADER_AUGUSTUS: { gameId: "Augustus", emojiId: "1464705367153049777", type: "None" },
//   LEADER_BENJAMIN_FRANKLIN: { gameId: "Benjamin_Franklin", emojiId: "1464705368847421440", type: "None" },
//   LEADER_BOLIVAR: { gameId: "Simon_Bolvar", emojiId: "1464705408722665670", type: "None" },
//   LEADER_CATHERINE: { gameId: "Catherine_the_Great", emojiId: "1464705370315297034", type: "None" },
//   LEADER_CHARLEMAGNE: { gameId: "Charlemagne", emojiId: "1464705372739731486", type: "None" },
//   LEADER_CONFUCIUS: { gameId: "Confucius", emojiId: "1464705375956893750", type: "None" },
//   LEADER_EDWARD_TEACH: { gameId: "Edward_Teach", emojiId: "1464705377714311321", type: "None" },
//   LEADER_FRIEDRICH: { gameId: "Friedrich_Oblique", emojiId: "1464705380516106281", type: "None" },
//   LEADER_FRIEDRICH_ALT: { gameId: "Friedrich_Baroque", emojiId: "1464705379253485733", type: "None" },
//   LEADER_GENGHIS_KHAN: { gameId: "GenghisKhan", emojiId: "1464705382172721162", type: "None" },
//   LEADER_GILGAMESH: { gameId: "Gilgamesh", emojiId: "1469017372005503046", type: "None" },
//   LEADER_HARRIET_TUBMAN: { gameId: "Harriet_Tubman", emojiId: "1464705384198443182", type: "None" },
//   LEADER_HATSHEPSUT: { gameId: "Hatshepsut", emojiId: "1464705385704194153", type: "None" },
//   LEADER_HIMIKO: { gameId: "Himiko_Queen_of_Wa", emojiId: "1464705388501799216", type: "None" },
//   LEADER_HIMIKO_ALT: { gameId: "Himiko_High_Shaman", emojiId: "1464705386883055757", type: "None" },
//   LEADER_IBN_BATTUTA: { gameId: "Ibn_Battuta", emojiId: "1464705390460669972", type: "None" },
//   LEADER_ISABELLA: { gameId: "Isabella", emojiId: "1464705392104837180", type: "None" },
//   LEADER_JOSE_RIZAL: { gameId: "Jos", emojiId: "1464705393442947275", type: "None" },
//   LEADER_LAFAYETTE: { gameId: "Lafayette", emojiId: "1464705394973737141", type: "None" },
//   LEADER_LAKSHMIBAI: { gameId: "Lakshmibai", emojiId: "1464705396685148392", type: "None" },
//   LEADER_MACHIAVELLI: { gameId: "Machiavelli", emojiId: "1464705398195097923", type: "None" },
//   LEADER_NAPOLEON: { gameId: "Napoleon_Emperor", emojiId: "1464705400149643396", type: "None" },
//   LEADER_NAPOLEON_ALT: { gameId: "Napoleon_Revolutionary", emojiId: "1464705401961582612", type: "None" },
//   LEADER_PACHACUTI: { gameId: "Pachacuti", emojiId: "1464705404813705459", type: "None" },
//   LEADER_SAYYIDA_AL_HURRA: { gameId: "Sayyida_al_Hurra", emojiId: "1464705407455985767", type: "None" },
//   LEADER_TECUMSEH: { gameId: "Tecumseh", emojiId: "1464705410090144010", type: "None" },
//   LEADER_TRUNG_TRAC: { gameId: "Trung_Trac", emojiId: "1464705411436515491", type: "None" },
//   LEADER_XERXES: { gameId: "Xerxes_King_of_Kings", emojiId: "1464705414154424454", type: "None" },
//   LEADER_XERXES_ALT: { gameId: "Xerxes_the_Achaemenid", emojiId: "1464705416398245949", type: "None" },
// } satisfies Record<string, LeaderMeta>);

// export type Civ7LeaderKey = keyof typeof CIV7_LEADERS;

// export const CIV7_CIVS = Object.freeze({
//   /* Antiquity Age Civs */
//   CIVILIZATION_PERSIA: { gameId: "Persian", emojiId: "1464696340629164053", agePool: "Antiquity_Age" },
//   CIVILIZATION_AKSUM: { gameId: "Aksumite", emojiId: "1464696342205956249", agePool: "Antiquity_Age" },
//   CIVILIZATION_ASSYRIA: { gameId: "Assyria", emojiId: "1464696343917494374", agePool: "Antiquity_Age" },
//   CIVILIZATION_CARTHAGE: { gameId: "Carthaginian", emojiId: "1464696345448284201", agePool: "Antiquity_Age" },
//   CIVILIZATION_EGYPT: { gameId: "Egyptian", emojiId: "1464696346492666149", agePool: "Antiquity_Age" },
//   CIVILIZATION_GREECE: { gameId: "Greek", emojiId: "1464696348132769893", agePool: "Antiquity_Age" },
//   CIVILIZATION_HAN: { gameId: "Han", emojiId: "1464696350170939505", agePool: "Antiquity_Age" },
//   CIVILIZATION_KHMER: { gameId: "Khmer", emojiId: "1464696352503103692", agePool: "Antiquity_Age" },
//   CIVILIZATION_MAURYA: { gameId: "Mauryan", emojiId: "1464696353924976721", agePool: "Antiquity_Age" },
//   CIVILIZATION_MAYA: { gameId: "Maya", emojiId: "1464696355665739807", agePool: "Antiquity_Age" },
//   CIVILIZATION_MISSISSIPPIAN: { gameId: "Mississippian", emojiId: "1464696357414506507", agePool: "Antiquity_Age" },
//   CIVILIZATION_ROME: { gameId: "Roman", emojiId: "1464696359658717395", agePool: "Antiquity_Age" },
//   CIVILIZATION_SILLA: { gameId: "Silla", emojiId: "1464696361080324270", agePool: "Antiquity_Age" },
//   CIVILIZATION_TONGA: { gameId: "Tongan", emojiId: "1464696362422632468", agePool: "Antiquity_Age" },  
//   /* Exploration Age Civs */
//   CIVILIZATION_ABBASID: { gameId: "Abbasid", emojiId: "1464701076069421271", agePool: "Exploration_Age" },
//   CIVILIZATION_BULGARIA: { gameId: "Bulgarian", emojiId: "1464701077613052156", agePool: "Exploration_Age" },
//   CIVILIZATION_CHOLA: { gameId: "Chola", emojiId: "1464701079408214161", agePool: "Exploration_Age" },
//   CIVILIZATION_HAWAII: { gameId: "Hawaiian", emojiId: "1464701080670834909", agePool: "Exploration_Age" },
//   CIVILIZATION_ICELAND: { gameId: "Icelandic", emojiId: "1464701083493601472", agePool: "Exploration_Age" },
//   CIVILIZATION_INCA: { gameId: "Incan", emojiId: "1464701085435560099", agePool: "Exploration_Age" },
//   CIVILIZATION_MAJAPAHIT: { gameId: "Majapahit", emojiId: "1464701086769221869", agePool: "Exploration_Age" },
//   CIVILIZATION_MING: { gameId: "Ming", emojiId: "1464701088677494794", agePool: "Exploration_Age" },
//   CIVILIZATION_MONGOLIA: { gameId: "Mongolian", emojiId: "1464701090376450182", agePool: "Exploration_Age" },
//   CIVILIZATION_NORMAN: { gameId: "Norman", emojiId: "1464701091953250426", agePool: "Exploration_Age" },
//   CIVILIZATION_PIRATE_REPUBLIC: { gameId: "Pirate", emojiId: "1464701093945802943", agePool: "Exploration_Age" },
//   CIVILIZATION_SHAWNEE: { gameId: "Shawnee", emojiId: "1464701095673856041", agePool: "Exploration_Age" },
//   CIVILIZATION_SONGHAI: { gameId: "Songhai", emojiId: "1464701097322221679", agePool: "Exploration_Age" },
//   CIVILIZATION_SPAIN: { gameId: "Spanish", emojiId: "1464701098886430901", agePool: "Exploration_Age" },
//   CIVILIZATION_VIETNAM: { gameId: "Vietnamese", emojiId: "1464701100849627229", agePool: "Exploration_Age" },
//   /* Modern Age Civs */
//   CIVILIZATION_AMERICA: { gameId: "American", emojiId: "1464703951285915790", agePool: "Modern_Age" },
//   CIVILIZATION_GREAT_BRITAIN: { gameId: "British", emojiId: "1464703952762441856", agePool: "Modern_Age" },
//   CIVILIZATION_BUGANDA: { gameId: "Bugandan", emojiId: "1464703954695880797", agePool: "Modern_Age" },
//   CIVILIZATION_FRENCH_EMPIRE: { gameId: "French_Imperial", emojiId: "1464703956541509695", agePool: "Modern_Age" },
//   CIVILIZATION_MEIJI: { gameId: "Meiji_Japanese", emojiId: "1464703958382547077", agePool: "Modern_Age" },
//   CIVILIZATION_MEXICO: { gameId: "Mexican", emojiId: "1464703960144281849", agePool: "Modern_Age" },
//   CIVILIZATION_MUGHAL: { gameId: "Mughal", emojiId: "1464703961159438457", agePool: "Modern_Age" },
//   CIVILIZATION_NEPAL: { gameId: "Nepalese", emojiId: "1464703962828771429", agePool: "Modern_Age" },
//   CIVILIZATION_OTTOMANS: { gameId: "Ottoman", emojiId: "1464703964250374335", agePool: "Modern_Age" },
//   CIVILIZATION_PRUSSIA: { gameId: "Prussian", emojiId: "1464703966347661353", agePool: "Modern_Age" },
//   CIVILIZATION_QAJAR: { gameId: "Qajar", emojiId: "1464703967945818134", agePool: "Modern_Age" },
//   CIVILIZATION_QING: { gameId: "Qing", emojiId: "1464703969782665550", agePool: "Modern_Age" },
//   CIVILIZATION_RUSSIA: { gameId: "Russian", emojiId: "1464703972215361762", agePool: "Modern_Age" },
//   CIVILIZATION_SIAM: { gameId: "Siam", emojiId: "1464703973654270176", agePool: "Modern_Age" },
// } satisfies Record<string, CivMeta>);

/* test bot data */
export const CIV7_LEADERS = Object.freeze({
  LEADER_ADA_LOVELACE: { gameId: "Ada_Lovelace", emojiId: "1466899785632972800", type: "None" },
  LEADER_AMINA: { gameId: "Amina", emojiId: "1466899786958503999", type: "None" },
  LEADER_ASHOKA: { gameId: "Ashoka_World_Renouncer", emojiId: "1466899791647604796", type: "None" },
  LEADER_ASHOKA_ALT: { gameId: "Ashoka_World_Conqueror", emojiId: "1466899789714030694", type: "None" },
  LEADER_AUGUSTUS: { gameId: "Augustus", emojiId: "1466899793841492174", type: "None" },
  LEADER_BENJAMIN_FRANKLIN: { gameId: "Benjamin_Franklin", emojiId: "1466899795816878080", type: "None" },
  LEADER_BOLIVAR: { gameId: "Simon_Bolvar", emojiId: "1466899844647096475", type: "None" },
  LEADER_CATHERINE: { gameId: "Catherine_the_Great", emojiId: "1466899797771423826", type: "None" },
  LEADER_CHARLEMAGNE: { gameId: "Charlemagne", emojiId: "1466899800560763080", type: "None" },
  LEADER_CONFUCIUS: { gameId: "Confucius", emojiId: "1466899802120913090", type: "None" },
  LEADER_EDWARD_TEACH: { gameId: "Edward_Teach", emojiId: "1466899803953959054", type: "None" },
  LEADER_FRIEDRICH: { gameId: "Friedrich_Oblique", emojiId: "1466899809104302285", type: "None" },
  LEADER_FRIEDRICH_ALT: { gameId: "Friedrich_Baroque", emojiId: "1466899806801891329", type: "None" },
  LEADER_GENGHIS_KHAN: { gameId: "GenghisKhan", emojiId: "1466899813747658839", type: "None" },
  LEADER_GILGAMESH: { gameId: "Gilgamesh", emojiId: "1469016857955664105", type: "None" }, 
  LEADER_HARRIET_TUBMAN: { gameId: "Harriet_Tubman", emojiId: "1466899817144778952", type: "None" },
  LEADER_HATSHEPSUT: { gameId: "Hatshepsut", emojiId: "1466899818705059840", type: "None" },
  LEADER_HIMIKO: { gameId: "Himiko_Queen_of_Wa", emojiId: "1466899822337589392", type: "None" },
  LEADER_HIMIKO_ALT: { gameId: "Himiko_High_Shaman", emojiId: "1466899820651221054", type: "None" },
  LEADER_IBN_BATTUTA: { gameId: "Ibn_Battuta", emojiId: "1466899824052928534", type: "None" },
  LEADER_ISABELLA: { gameId: "Isabella", emojiId: "1466899825927786720", type: "None" },
  LEADER_JOSE_RIZAL: { gameId: "Jos", emojiId: "1466899827928334439", type: "None" },
  LEADER_LAFAYETTE: { gameId: "Lafayette", emojiId: "1466899829614444729", type: "None" },
  LEADER_LAKSHMIBAI: { gameId: "Lakshmibai", emojiId: "1466899831103426853", type: "None" },
  LEADER_MACHIAVELLI: { gameId: "Machiavelli", emojiId: "1466899834157138274", type: "None" },
  LEADER_NAPOLEON: { gameId: "Napoleon_Emperor", emojiId: "1466899835704836177", type: "None" },
  LEADER_NAPOLEON_ALT: { gameId: "Napoleon_Revolutionary", emojiId: "1466899837466316932", type: "None" },
  LEADER_PACHACUTI: { gameId: "Pachacuti", emojiId: "1466899839563464967", type: "None" },
  LEADER_SAYYIDA_AL_HURRA: { gameId: "Sayyida_al_Hurra", emojiId: "1466899841828520058", type: "None" },
  LEADER_TECUMSEH: { gameId: "Tecumseh", emojiId: "1466899846987387173", type: "None" },
  LEADER_TRUNG_TRAC: { gameId: "Trung_Trac", emojiId: "1466899849323614411", type: "None" },
  LEADER_XERXES: { gameId: "Xerxes_King_of_Kings", emojiId: "1466899851781341338", type: "None" },
  LEADER_XERXES_ALT: { gameId: "Xerxes_the_Achaemenid", emojiId: "1466899854499516419", type: "None" },
} satisfies Record<string, LeaderMeta>);

export type Civ7LeaderKey = keyof typeof CIV7_LEADERS;

export const CIV7_CIVS = Object.freeze({
  /* Antiquity Age Civs */
  CIVILIZATION_PERSIA: { gameId: "Persian", emojiId: "1466892947835322564", agePool: "Antiquity_Age" },
  CIVILIZATION_AKSUM: { gameId: "Aksumite", emojiId: "1466892949148143696", agePool: "Antiquity_Age" },
  CIVILIZATION_ASSYRIA: { gameId: "Assyria", emojiId: "1466892950494642403", agePool: "Antiquity_Age" },
  CIVILIZATION_CARTHAGE: { gameId: "Carthaginian", emojiId: "1466892952323227832", agePool: "Antiquity_Age" },
  CIVILIZATION_EGYPT: { gameId: "Egyptian", emojiId: "1466892953925718097", agePool: "Antiquity_Age" },
  CIVILIZATION_GREECE: { gameId: "Greek", emojiId: "1466892955158839600", agePool: "Antiquity_Age" },
  CIVILIZATION_HAN: { gameId: "Han", emojiId: "1466892956819656871", agePool: "Antiquity_Age" },
  CIVILIZATION_KHMER: { gameId: "Khmer", emojiId: "1466892958291722250", agePool: "Antiquity_Age" },
  CIVILIZATION_MAURYA: { gameId: "Mauryan", emojiId: "1466892960527417404", agePool: "Antiquity_Age" },
  CIVILIZATION_MAYA: { gameId: "Maya", emojiId: "1466892961848627363", agePool: "Antiquity_Age" },
  CIVILIZATION_MISSISSIPPIAN: { gameId: "Mississippian", emojiId: "1466892963131949280", agePool: "Antiquity_Age" },
  CIVILIZATION_ROME: { gameId: "Roman", emojiId: "1466892964507816109", agePool: "Antiquity_Age" },
  CIVILIZATION_SILLA: { gameId: "Silla", emojiId: "1466892965984079963", agePool: "Antiquity_Age" },
  CIVILIZATION_TONGA: { gameId: "Tongan", emojiId: "1466892967921975538", agePool: "Antiquity_Age" },  
  /* Exploration Age Civs */
  CIVILIZATION_ABBASID: { gameId: "Abbasid", emojiId: "1466898203508084968", agePool: "Exploration_Age" },
  CIVILIZATION_BULGARIA: { gameId: "Bulgarian", emojiId: "1466898205093396541", agePool: "Exploration_Age" },
  CIVILIZATION_CHOLA: { gameId: "Chola", emojiId: "1466898207039684875", agePool: "Exploration_Age" },
  CIVILIZATION_HAWAII: { gameId: "Hawaiian", emojiId: "1466898208797102101", agePool: "Exploration_Age" },
  CIVILIZATION_ICELAND: { gameId: "Icelandic", emojiId: "1466898210932003063", agePool: "Exploration_Age" },
  CIVILIZATION_INCA: { gameId: "Incan", emojiId: "1466898212768977077", agePool: "Exploration_Age" },
  CIVILIZATION_MAJAPAHIT: { gameId: "Majapahit", emojiId: "1466898214178525330", agePool: "Exploration_Age" },
  CIVILIZATION_MING: { gameId: "Ming", emojiId: "1466898215646527600", agePool: "Exploration_Age" },
  CIVILIZATION_MONGOLIA: { gameId: "Mongolian", emojiId: "1466898216929722620", agePool: "Exploration_Age" },
  CIVILIZATION_NORMAN: { gameId: "Norman", emojiId: "1466898218397995276", agePool: "Exploration_Age" },
  CIVILIZATION_PIRATE_REPUBLIC: { gameId: "Pirate", emojiId: "1466898220218060961", agePool: "Exploration_Age" },
  CIVILIZATION_SHAWNEE: { gameId: "Shawnee", emojiId: "1466898222491635783", agePool: "Exploration_Age" },
  CIVILIZATION_SONGHAI: { gameId: "Songhai", emojiId: "1466898224450109694", agePool: "Exploration_Age" },
  CIVILIZATION_SPAIN: { gameId: "Spanish", emojiId: "1466898226572558619", agePool: "Exploration_Age" },
  CIVILIZATION_VIETNAM: { gameId: "Vietnamese", emojiId: "1466898228078317783", agePool: "Exploration_Age" },
  /* Modern Age Civs */
  CIVILIZATION_AMERICA: { gameId: "American", emojiId: "1466898861766480027", agePool: "Modern_Age" },
  CIVILIZATION_GREAT_BRITAIN: { gameId: "British", emojiId: "1466898864370880754", agePool: "Modern_Age" },
  CIVILIZATION_BUGANDA: { gameId: "Bugandan", emojiId: "1466898865964716072", agePool: "Modern_Age" },
  CIVILIZATION_FRENCH_EMPIRE: { gameId: "French_Imperial", emojiId: "1466898867273597099", agePool: "Modern_Age" },
  CIVILIZATION_MEIJI: { gameId: "Meiji_Japanese", emojiId: "1466898868720632051", agePool: "Modern_Age" },
  CIVILIZATION_MEXICO: { gameId: "Mexican", emojiId: "1466898870482239701", agePool: "Modern_Age" },
  CIVILIZATION_MUGHAL: { gameId: "Mughal", emojiId: "1466898878216540321", agePool: "Modern_Age" },
  CIVILIZATION_NEPAL: { gameId: "Nepalese", emojiId: "1466898879692935352", agePool: "Modern_Age" },
  CIVILIZATION_OTTOMANS: { gameId: "Ottoman", emojiId: "1466898882221838650", agePool: "Modern_Age" },
  CIVILIZATION_PRUSSIA: { gameId: "Prussian", emojiId: "1466898884721643813", agePool: "Modern_Age" },
  CIVILIZATION_QAJAR: { gameId: "Qajar", emojiId: "1466898886697419036", agePool: "Modern_Age" },
  CIVILIZATION_QING: { gameId: "Qing", emojiId: "1466898890358919258", agePool: "Modern_Age" },
  CIVILIZATION_RUSSIA: { gameId: "Russian", emojiId: "1466898893957500962", agePool: "Modern_Age" },
  CIVILIZATION_SIAM: { gameId: "Siam", emojiId: "1466898896079819013", agePool: "Modern_Age" },
} satisfies Record<string, CivMeta>);

function render(gameId: string, emojiId?: string): string {
  const id = emojiId?.trim();
  if (id && /^\d{15,22}$/.test(id)) {
    return `<:${gameId}:${id}>`;
  }
  return gameId;
}

export type Civ7CivKey = keyof typeof CIV7_CIVS;

export function lookupCiv7LeaderMeta(key: string): LeaderMeta | undefined {
  return (CIV7_LEADERS as Readonly<Record<string, LeaderMeta>>)[key];
}

export function lookupCiv7Leader(key: string): string {
  return lookupCiv7LeaderMeta(key)?.gameId ?? key;
}

export function lookupCiv7CivMeta(key: string): CivMeta | undefined {
  return (CIV7_CIVS as Readonly<Record<string, CivMeta>>)[key];
}

export function lookupCiv7Civ(key: string): string {
  return lookupCiv7CivMeta(key)?.gameId ?? key;
}

export function formatCiv7Leader(key: string): string {
  const meta = lookupCiv7LeaderMeta(key);
  return meta ? render(meta.gameId, meta.emojiId) : "—";
}

export function formatCiv7Civ(key: string): string {
  const meta = lookupCiv7CivMeta(key);
  return meta ? render(meta.gameId, meta.emojiId) : "—";
}
