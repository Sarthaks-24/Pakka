// Fixed question, option and card text in Gujarati, Hindi and English.
// Native-speaker check pending: have a Gujarati and a Hindi speaker read every string before recording.
// Questions are never produced by the LLM, so they cannot be mistranslated.

const months = {
  gu: ["જાન્યુઆરી", "ફેબ્રુઆરી", "માર્ચ", "એપ્રિલ", "મે", "જૂન", "જુલાઈ", "ઓગસ્ટ", "સપ્ટેમ્બર", "ઓક્ટોબર", "નવેમ્બર", "ડિસેમ્બર"],
  hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

export const T = {
  gu: {
    confirmed: "નક્કી થયું:",
    cardTitle: "નક્કી થયેલી શરતો",
    slots: { quantity: "જથ્થો", product: "માલ", price: "ભાવ", delivery: "ડિલિવરી", payment: "ચુકવણી" },
    units: { meter: "મીટર", roll: "રોલ", kg: "કિલો", piece: "પીસ", than: "થાન", dozen: "ડઝન", bale: "ગાંસડી", lot: "લોટ" },
    per: "પ્રતિ",
    currency: { INR: "રૂપિયા", USD: "ડોલર" },
    gst: { included: "GST સાથે", extra: "GST અલગથી" },
    advance: (pct) => `એડવાન્સ ${pct}%`,
    balanceWord: "બાકી",
    balance: { "on delivery": "ડિલિવરી વખતે", "30 days after delivery": "ડિલિવરીના 30 દિવસ પછી" },
    options: { switchMeters: "મીટરમાં ફેરવો", keepUnit: "આમ જ રાખો, લંબાઈ પછી નક્કી કરીશું" },
    questions: {
      A1: "તમે જથ્થો કહ્યો, પણ એકમ નથી કહ્યું. મીટર, રોલ, કિલો કે પીસ?",
      A2: "રોલની લંબાઈ અલગ અલગ હોઈ શકે. મીટરમાં ફેરવીએ, કે રોલ રાખીને લંબાઈ પછી નક્કી કરીએ?",
      A3: "ડિલિવરીની ચોક્કસ તારીખ કઈ?",
      A4: "આ ભાવ GST સાથે છે કે GST અલગથી?",
      A5: "આ ભાવ પ્રતિ મીટર છે, પ્રતિ કિલો કે પ્રતિ પીસ?",
      A6: "તમે એડવાન્સ કહ્યું. બાકીના પૈસા ક્યારે આપવાના?",
      A7: "માલની વિગત સ્પષ્ટ નથી. તમારો મતલબ કયો?",
      A8: "ભાવ અગાઉ નક્કી થયેલા ભાવથી બદલાયો છે. કયો ભાવ સાચો?",
      A9: "બે દરખાસ્ત હતી. તમે કઈ માન્ય રાખો છો?",
      A10: "ભાવ રૂપિયામાં છે કે ડોલરમાં?",
    },
  },
  hi: {
    confirmed: "पक्का हुआ:",
    cardTitle: "पक्की शर्तें",
    slots: { quantity: "मात्रा", product: "माल", price: "भाव", delivery: "डिलीवरी", payment: "भुगतान" },
    units: { meter: "मीटर", roll: "रोल", kg: "किलो", piece: "पीस", than: "थान", dozen: "दर्जन", bale: "गांठ", lot: "लॉट" },
    per: "प्रति",
    currency: { INR: "रुपये", USD: "डॉलर" },
    gst: { included: "GST सहित", extra: "GST अलग से" },
    advance: (pct) => `एडवांस ${pct}%`,
    balanceWord: "बाकी",
    balance: { "on delivery": "डिलीवरी पर", "30 days after delivery": "डिलीवरी के 30 दिन बाद" },
    options: { switchMeters: "मीटर में बदलें", keepUnit: "ऐसे ही रखें, लंबाई बाद में पक्की करेंगे" },
    questions: {
      A1: "आपने मात्रा बताई, पर इकाई नहीं बताई। मीटर, रोल, किलो या पीस?",
      A2: "रोल की लंबाई अलग-अलग हो सकती है। मीटर में बदलें, या रोल रखकर लंबाई बाद में पक्की करें?",
      A3: "डिलीवरी की ठीक कौन सी तारीख है?",
      A4: "यह भाव GST सहित है या GST अलग से?",
      A5: "यह भाव प्रति मीटर है, प्रति किलो या प्रति पीस?",
      A6: "आपने एडवांस बताया। बाकी पैसे कब देने हैं?",
      A7: "माल का विवरण साफ़ नहीं है। आपका मतलब कौन सा है?",
      A8: "भाव पहले तय हुए भाव से बदल गया है। कौन सा भाव सही है?",
      A9: "दो प्रस्ताव थे। आप किसे मान रहे हैं?",
      A10: "भाव रुपये में है या डॉलर में?",
    },
  },
  en: {
    confirmed: "Confirmed:",
    cardTitle: "Confirmed terms",
    slots: { quantity: "Quantity", product: "Product", price: "Price", delivery: "Delivery", payment: "Payment" },
    units: { meter: "meters", roll: "rolls", kg: "kg", piece: "pieces", than: "than", dozen: "dozen", bale: "bales", lot: "lots" },
    per: "per",
    perUnits: { meter: "meter", roll: "roll", kg: "kg", piece: "piece", than: "than", dozen: "dozen", bale: "bale", lot: "lot" },
    currency: { INR: "rupees", USD: "dollars" },
    gst: { included: "GST included", extra: "GST extra" },
    advance: (pct) => `advance ${pct}%`,
    balanceWord: "balance",
    balance: { "on delivery": "on delivery", "30 days after delivery": "30 days after delivery" },
    options: { switchMeters: "Switch to meters", keepUnit: "Keep as is, confirm length later" },
    questions: {
      A1: "You gave a quantity but no unit. Is it meters, rolls, kg or pieces?",
      A2: "Rolls can have different lengths. Switch to meters, or keep rolls and confirm the length later?",
      A3: "Which exact date do you mean for delivery?",
      A4: "Is the price with GST included or GST extra?",
      A5: "Is that price per meter, per kg or per piece?",
      A6: "You mentioned an advance. When is the balance paid?",
      A7: "The product detail is not clear. Which one do you mean?",
      A8: "The price is different from what was agreed. Which price is right?",
      A9: "There were two offers. Which one do you agree to?",
      A10: "Is the price in rupees or dollars?",
    },
  },
};

export const shortLang = (lang) => String(lang || "").slice(0, 2);

export function t(lang) {
  return T[shortLang(lang)] ?? T.en;
}

export function monthName(lang, index) {
  return (months[shortLang(lang)] ?? months.en)[index];
}

export function question(type, lang) {
  return t(lang).questions[type];
}

// Same value in every language, for labels that are numbers or free LLM text.
export function sameLabel(text) {
  return { gu: text, hi: text, en: text };
}

// Label for each language, built by a function of the short language code.
export function label(fn) {
  return { gu: fn("gu"), hi: fn("hi"), en: fn("en") };
}
