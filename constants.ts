

// --- ISO MAPPING FOR FLAGS ---
export const COUNTRY_ISO: Record<string, string> = {
    // A
    "Afghanistan": "af", "Afrique du Sud": "za", "Albanie": "al", "Algérie": "dz", "Allemagne": "de", "Andorre": "ad", "Angola": "ao", "Arabie saoudite": "sa", "Argentine": "ar", "Arménie": "am", "Australie": "au", "Autriche": "at", "Azerbaïdjan": "az",
    // B
    "Bahamas": "bs", "Bahreïn": "bh", "Bangladesh": "bd", "Barbade": "bb", "Belgique": "be", "Belize": "bz", "Bénin": "bj", "Bhoutan": "bt", "Biélorussie": "by", "Birmanie": "mm", "Bolivie": "bo", "Bosnie-Herzégovine": "ba", "Botswana": "bw", "Brésil": "br", "Brunei": "bn", "Bulgarie": "bg", "Burkina Faso": "bf", "Burundi": "bi",
    // C
    "Cambodge": "kh", "Cameroun": "cm", "Canada": "ca", "Cap-Vert": "cv", "Chili": "cl", "Chine": "cn", "Chypre": "cy", "Colombie": "co", "Comores": "km", "Congo": "cg", "Corée du Nord": "kp", "Corée du Sud": "kr", "Costa Rica": "cr", "Côte d'Ivoire": "ci", "Croatie": "hr", "Cuba": "cu",
    // D
    "Danemark": "dk", "Djibouti": "dj", "Dominique": "dm",
    // E
    "Égypte": "eg", "Émirats arabes unis": "ae", "Équateur": "ec", "Érythrée": "er", "Espagne": "es", "Estonie": "ee", "États fédérés de Micronésie": "fm", "États-Unis": "us", "Éthiopie": "et", "Eswatini": "sz", "État de Palestine": "ps",
    // F
    "Fidji": "fj", "Finlande": "fi", "France": "fr",
    // G
    "Gabon": "ga", "Gambie": "gm", "Géorgie": "ge", "Ghana": "gh", "Grèce": "gr", "Grenade": "gd", "Guatemala": "gt", "Guinée": "gn", "Guinée équatoriale": "gq", "Guinée-Bissau": "gw", "Guyana": "gy",
    // H
    "Haïti": "ht", "Honduras": "hn", "Hongrie": "hu",
    // I
    "Îles Marshall": "mh", "Îles Salomon": "sb", "Inde": "in", "Indonésie": "id", "Irak": "iq", "Iran": "ir", "Irlande": "ie", "Islande": "is", "Israël": "il", "Italie": "it",
    // J
    "Jamaïque": "jm", "Japon": "jp", "Jordanie": "jo",
    // K
    "Kazakhstan": "kz", "Kenya": "ke", "Kirghizistan": "kg", "Kiribati": "ki", "Kosovo": "xk", "Koweït": "kw",
    // L
    "Laos": "la", "Lesotho": "ls", "Lettonie": "lv", "Liban": "lb", "Liberia": "lr", "Libye": "ly", "Liechtenstein": "li", "Lituanie": "lt", "Luxembourg": "lu",
    // M
    "Macédoine": "mk", "Macédoine du Nord": "mk", "Madagascar": "mg", "Malaisie": "my", "Malawi": "mw", "Maldives": "mv", "Mali": "ml", "Malte": "mt", "Maroc": "ma", "Maurice": "mu", "Mauritanie": "mr", "Mexique": "mx", "Moldavie": "md", "Monaco": "mc", "Mongolie": "mn", "Monténégro": "me", "Mozambique": "mz",
    // N
    "Namibie": "na", "Nauru": "nr", "Népal": "np", "Nicaragua": "ni", "Niger": "ne", "Nigeria": "ng", "Norvège": "no", "Nouvelle-Zélande": "nz",
    // O
    "Oman": "om", "Ouganda": "ug", "Ouzbékistan": "uz",
    // P
    "Pakistan": "pk", "Palaos": "pw", "Panama": "pa", "Papouasie-Nouvelle-Guinée": "pg", "Paraguay": "py", "Pays-Bas": "nl", "Pérou": "pe", "Philippines": "ph", "Pologne": "pl", "Portugal": "pt",
    // Q
    "Qatar": "qa",
    // R
    "République centrafricaine": "cf", "République démocratique du Congo": "cd", "République dominicaine": "do", "Roumanie": "ro", "Royaume-Uni": "gb", "Russie": "ru", "Rwanda": "rw",
    // S
    "Saint-Christophe-et-Niévès": "kn", "Sainte-Lucie": "lc", "Saint-Marin": "sm", "Saint-Vincent-et-les-Grenadines": "vc", "Salvador": "sv", "Samoa": "ws", "Sao Tomé-et-Principe": "st", "Sénégal": "sn", "Serbie": "rs", "Seychelles": "sc", "Sierra Leone": "sl", "Singapour": "sg", "Slovaquie": "sk", "Slovénie": "si", "Somalie": "so", "Soudan": "sd", "Soudan du Sud": "ss", "Sri Lanka": "lk", "Suède": "se", "Suisse": "ch", "Suriname": "sr", "Syrie": "sy",
    // T
    "Tadjikistan": "tj", "Taïwan": "tw", "Tanzanie": "tz", "Tchad": "td", "Tchéquie": "cz", "Thaïlande": "th", "Timor oriental": "tl", "Togo": "tg", "Tonga": "to", "Trinité-et-Tobago": "tt", "Tunisie": "tn", "Turkménistan": "tm", "Turquie": "tr", "Tuvalu": "tv",
    // U
    "Ukraine": "ua", "Uruguay": "uy",
    // V
    "Vanuatu": "vu", "Vatican": "va", "Venezuela": "ve", "Vietnam": "vn",
    // Y
    "Yémen": "ye",
    // Z
    "Zambie": "zm", "Zimbabwe": "zw"
};

export const getFlagUrl = (countryName: string | null) => {
    if (!countryName) return null;
    let code = COUNTRY_ISO[countryName];
    if (code) return `https://flagcdn.com/w40/${code}.png`;
    return `https://flagcdn.com/w40/un.png`; // Fallback to UN flag or similar if unknown
};

export const NUCLEAR_POWERS = [
    "États-Unis", "Russie", "Chine", "France", "Royaume-Uni", 
    "Inde", "Pakistan", "Israël", "Corée du Nord"
];

// Pays ayant une capacité spatiale avérée (lancement orbital)
export const SPACE_POWERS = [
    "États-Unis", "Russie", "Chine", "France", "Japon", "Inde", 
    "Israël", "Iran", "Corée du Nord", "Corée du Sud", "Royaume-Uni"
];

// Membres de l'OTAN en l'an 2000 (Avant l'élargissement de 2004)
export const NATO_MEMBERS_2000 = [
    "États-Unis", "Royaume-Uni", "France", "Allemagne", "Italie", "Canada", "Espagne", "Turquie", 
    "Pays-Bas", "Belgique", "Portugal", "Danemark", "Norvège", "Grèce", "Pologne", "Hongrie", 
    "Tchéquie", "Islande", "Luxembourg"
];

export const LANDLOCKED_COUNTRIES = [
    "Bolivie", "Paraguay", "Suisse", "Autriche", "Hongrie", "Slovaquie", "Tchéquie", "Serbie", "Macédoine du Nord", "Kosovo",
    "Biélorussie", "Moldavie", "Luxembourg", "Liechtenstein", "Saint-Marin", "Andorre", "Vatican",
    "Kazakhstan", "Ouzbékistan", "Kirghizistan", "Tadjikistan", "Turkménistan", "Afghanistan", "Mongolie", "Laos", "Népal", "Bhoutan", "Arménie", "Azerbaïdjan",
    "Mali", "Niger", "Tchad", "Burkina Faso", "République centrafricaine", "Soudan du Sud", "Éthiopie", "Ouganda", "Rwanda", "Burundi", "Zambie", "Zimbabwe", "Malawi", "Botswana", "Eswatini", "Lesotho"
];

export const ALL_COUNTRIES_LIST = Object.keys(COUNTRY_ISO).sort();

// --- AI CORRECTIONS & NORMALIZATION ---
// Mapping pour corriger les erreurs fréquentes de l'IA (Anglais/Abréviations -> Français Standard)
export const AI_NAME_CORRECTIONS: Record<string, string> = {
    "USA": "États-Unis",
    "United States": "États-Unis",
    "United States of America": "États-Unis",
    "US": "États-Unis",
    "America": "États-Unis",
    "UK": "Royaume-Uni",
    "United Kingdom": "Royaume-Uni",
    "Great Britain": "Royaume-Uni",
    "England": "Royaume-Uni",
    "Russia": "Russie",
    "China": "Chine",
    "Germany": "Allemagne",
    "Italy": "Italie",
    "Spain": "Espagne",
    "Greece": "Grèce", // Fix Grèce
    "Japan": "Japon",
    "South Korea": "Corée du Sud",
    "North Korea": "Corée du Nord",
    "Brazil": "Brésil",
    "India": "Inde",
    "Turkey": "Turquie",
    "Poland": "Pologne",
    "Ukraine": "Ukraine",
    "France": "France",
    "Canada": "Canada",
    "Australia": "Australie",
    "Iran": "Iran",
    "Israel": "Israël",
    "Egypt": "Égypte",
    "Republic of Kosovo": "Kosovo", // Fix Kosovo
    "Kosovo": "Kosovo",
    "Macedonia": "Macédoine du Nord",
    "Syria": "Syrie",
    "Lebanon": "Liban"
};

export const normalizeCountryName = (name: string): string => {
    // 1. Check exact match in corrections
    if (AI_NAME_CORRECTIONS[name]) return AI_NAME_CORRECTIONS[name];
    
    // 2. Try simple fuzzy match (if name is "The USA" etc)
    const upper = name.toUpperCase();
    for (const [key, val] of Object.entries(AI_NAME_CORRECTIONS)) {
        if (upper === key.toUpperCase()) return val;
    }

    // 3. Fallback: If it exists in ALL_COUNTRIES_LIST, return as is, otherwise capitalize or return
    // (We assume if it's not in corrections, the AI might have got it right or it's an edge case)
    return name;
};

// --- GEOJSON MAPPING ---
// Mapping spécifique pour convertir les noms anglais du GeoJSON en noms français de l'app
const GEOJSON_TO_FRENCH: Record<string, string> = {
    "United States of America": "États-Unis",
    "United States": "États-Unis",
    "United Kingdom": "Royaume-Uni",
    "Russia": "Russie",
    "China": "Chine",
    "Germany": "Allemagne",
    "France": "France",
    "Italy": "Italie",
    "Spain": "Espagne",
    "Japan": "Japon",
    "South Korea": "Corée du Sud",
    "North Korea": "Corée du Nord",
    "India": "Inde",
    "Brazil": "Brésil",
    "Canada": "Canada",
    "Australia": "Australie",
    "Iran": "Iran",
    "Turkey": "Turquie",
    "Poland": "Pologne",
    "Ukraine": "Ukraine",
    "Saudi Arabia": "Arabie saoudite",
    "Egypt": "Égypte",
    "South Africa": "Afrique du Sud",
    "Mexico": "Mexique",
    "Indonesia": "Indonésie",
    "Pakistan": "Pakistan",
    "Nigeria": "Nigéria",
    "Argentina": "Argentine",
    "Algeria": "Algérie",
    "Sudan": "Soudan",
    "Democratic Republic of the Congo": "République démocratique du Congo",
    "Morocco": "Maroc",
    "Afghanistan": "Afghanistan",
    "Iraq": "Irak",
    "Venezuela": "Venezuela",
    "Colombia": "Colombie",
    "Peru": "Pérou",
    "Chile": "Chili",
    "Sweden": "Suède",
    "Norway": "Norvège",
    "Finland": "Finlande",
    "Denmark": "Danemark",
    "Netherlands": "Pays-Bas",
    "Belgium": "Belgique",
    "Switzerland": "Suisse",
    "Austria": "Autriche",
    "Greece": "Grèce",
    "Portugal": "Portugal",
    "Ireland": "Irlande",
    "Vietnam": "Vietnam",
    "Thailand": "Thaïlande",
    "Philippines": "Philippines",
    "Malaysia": "Malaisie",
    "New Zealand": "Nouvelle-Zélande",
    "Israel": "Israël",
    "Syria": "Syrie",
    "Kazakhstan": "Kazakhstan",
    "Uzbekistan": "Ouzbékistan",
    "Romania": "Roumanie",
    "Czech Republic": "Tchéquie",
    "Hungary": "Hongrie",
    "Belarus": "Biélorussie",
    "Greenland": "Groenland",
    "Iceland": "Islande",
    "Mongolia": "Mongolie",
    "Yemen": "Yémen",
    "Libya": "Libye",
    "Chad": "Tchad",
    "Niger": "Niger",
    "Mali": "Mali",
    "Mauritania": "Mauritanie",
    "Senegal": "Sénégal",
    "Guinea": "Guinée",
    "Sierra Leone": "Sierra Leone",
    "Liberia": "Liberia",
    "Ivory Coast": "Côte d'Ivoire",
    "Ghana": "Ghana",
    "Burkina Faso": "Burkina Faso",
    "Togo": "Togo",
    "Benin": "Bénin",
    "Cameroon": "Cameroun",
    "Central African Republic": "République centrafricaine",
    "Gabon": "Gabon",
    "Congo": "Congo",
    "Angola": "Angola",
    "Namibia": "Namibie",
    "Botswana": "Botswana",
    "Zimbabwe": "Zimbabwe",
    "Zambia": "Zambie",
    "Mozambique": "Mozambique",
    "Tanzania": "Tanzanie",
    "Kenya": "Kenya",
    "Somalia": "Somalie",
    "Ethiopia": "Éthiopie",
    "Eritrea": "Érythrée",
    "Djibouti": "Djibouti",
    "Madagascar": "Madagascar",
    "Turkmenistan": "Turkménistan",
    "Tajikistan": "Tadjikistan",
    "Kyrgyzstan": "Kirghizistan",
    "Georgia": "Géorgie",
    "Armenia": "Arménie",
    "Azerbaijan": "Azerbaïdjan",
    "Moldova": "Moldavie",
    "Estonia": "Estonie",
    "Latvia": "Lettonie",
    "Lithuania": "Lituanie",
    "Serbia": "Serbie",
    "Montenegro": "Monténégro",
    "Kosovo": "Kosovo",
    "Macedonia": "Macédoine du Nord",
    "Albania": "Albanie",
    "Bulgaria": "Bulgarie",
    "Bosnia and Herzegovina": "Bosnie-Herzégovine",
    "Croatia": "Croatie",
    "Slovenia": "Slovénie",
    "Slovakia": "Slovaquie",
    "Bolivia": "Bolivie",
    "Paraguay": "Paraguay",
    "Uruguay": "Uruguay",
    "Ecuador": "Équateur",
    "Guyana": "Guyana",
    "Suriname": "Suriname",
    "Cuba": "Cuba",
    "Haiti": "Haïti",
    "Dominican Republic": "République dominicaine",
    "Jamaica": "Jamaïque",
    "Honduras": "Honduras",
    "Nicaragua": "Nicaragua",
    "Costa Rica": "Costa Rica",
    "Panama": "Panama",
    "El Salvador": "Salvador",
    "Guatemala": "Guatemala",
    "Belize": "Belize",
    "Papua New Guinea": "Papouasie-Nouvelle-Guinée",
    "Taiwan": "Taïwan",
    "Laos": "Laos",
    "Cambodia": "Cambodge",
    "Myanmar": "Birmanie",
    "Bangladesh": "Bangladesh",
    "Bhutan": "Bhoutan",
    "Nepal": "Népal",
    "Sri Lanka": "Sri Lanka",
    "The Bahamas": "Bahamas",
    "Republic of Serbia": "Serbie",
    "United Republic of Tanzania": "Tanzanie"
};

export const getFrenchName = (name: string): string => {
    // 1. Priorité: Mapping GeoJSON spécifique
    if (GEOJSON_TO_FRENCH[name]) return GEOJSON_TO_FRENCH[name];

    // 2. Si le nom est déjà dans la liste des pays supportés (clés ISO), on le garde
    if (COUNTRY_ISO[name]) return name;
    
    // 3. Essai de normalisation via les corrections IA
    const normalized = normalizeCountryName(name);
    if (COUNTRY_ISO[normalized]) return normalized;

    // 4. Fallback: retourne le nom tel quel (l'utilisateur verra le nom anglais du GeoJSON)
    return name;
};