export type WordType = 'noun' | 'verb' | 'adjective' | 'adverb' | 'conjunction' | 'preposition' | 'phrase' | 'other';

export interface Word {
  id: string;
  de: string;
  article?: 'der' | 'die' | 'das';
  plural?: string;
  en: string;
  type: WordType;
  category?: string;
}

export const WORDS: Word[] = [
  // A
  { id: 'w001', de: 'Abend', article: 'der', plural: 'Abende', en: 'evening', type: 'noun', category: 'Zeit' },
  { id: 'w002', de: 'Abfahrt', article: 'die', plural: 'Abfahrten', en: 'departure', type: 'noun', category: 'Verkehr' },
  { id: 'w003', de: 'Abfall', article: 'der', plural: 'Abfälle', en: 'rubbish', type: 'noun', category: 'Alltag' },
  { id: 'w004', de: 'Abgase', article: 'die', plural: 'Abgase', en: 'exhaust fumes', type: 'noun', category: 'Umwelt' },
  { id: 'w005', de: 'Abgeordnete', article: 'der', plural: 'Abgeordneten', en: 'member of parliament', type: 'noun', category: 'Politik' },
  { id: 'w006', de: 'Abitur', article: 'das', plural: 'Abiture', en: 'school-leaving certificate', type: 'noun', category: 'Bildung' },
  { id: 'w007', de: 'Absatz', article: 'der', plural: 'Absätze', en: 'paragraph', type: 'noun', category: 'Sprache' },
  { id: 'w008', de: 'Abschnitt', article: 'der', plural: 'Abschnitte', en: 'section', type: 'noun', category: 'Sprache' },
  { id: 'w009', de: 'Absender', article: 'der', plural: 'Absender', en: 'sender', type: 'noun', category: 'Kommunikation' },
  { id: 'w010', de: 'Abteilung', article: 'die', plural: 'Abteilungen', en: 'department', type: 'noun', category: 'Arbeit' },
  { id: 'w011', de: 'Adresse', article: 'die', plural: 'Adressen', en: 'address', type: 'noun', category: 'Alltag' },
  { id: 'w012', de: 'Ahnung', article: 'die', plural: 'Ahnungen', en: 'idea / clue', type: 'noun', category: 'Alltag' },
  { id: 'w013', de: 'Akzent', article: 'der', plural: 'Akzente', en: 'accent', type: 'noun', category: 'Sprache' },
  { id: 'w014', de: 'Albanien', article: 'das', plural: '', en: 'Albania', type: 'noun', category: 'Länder' },
  { id: 'w015', de: 'Alter', article: 'das', plural: '', en: 'age', type: 'noun', category: 'Person' },
  { id: 'w016', de: 'Ampel', article: 'die', plural: 'Ampeln', en: 'traffic light', type: 'noun', category: 'Verkehr' },
  { id: 'w017', de: 'Amt', article: 'das', plural: 'Ämter', en: 'office / authority', type: 'noun', category: 'Behörde' },
  { id: 'w018', de: 'Angebot', article: 'das', plural: 'Angebote', en: 'offer', type: 'noun', category: 'Einkaufen' },
  { id: 'w019', de: 'Angst', article: 'die', plural: 'Ängste', en: 'fear', type: 'noun', category: 'Gefühle' },
  { id: 'w020', de: 'Ankunft', article: 'die', plural: 'Ankünfte', en: 'arrival', type: 'noun', category: 'Verkehr' },
  { id: 'w021', de: 'Anmeldung', article: 'die', plural: 'Anmeldungen', en: 'registration', type: 'noun', category: 'Behörde' },
  { id: 'w022', de: 'Antwort', article: 'die', plural: 'Antworten', en: 'answer', type: 'noun', category: 'Kommunikation' },
  { id: 'w023', de: 'Anzeige', article: 'die', plural: 'Anzeigen', en: 'advertisement', type: 'noun', category: 'Medien' },
  { id: 'w024', de: 'Apfel', article: 'der', plural: 'Äpfel', en: 'apple', type: 'noun', category: 'Essen' },
  { id: 'w025', de: 'Apotheke', article: 'die', plural: 'Apotheken', en: 'pharmacy', type: 'noun', category: 'Gesundheit' },
  { id: 'w026', de: 'Arbeit', article: 'die', plural: 'Arbeiten', en: 'work', type: 'noun', category: 'Arbeit' },
  { id: 'w027', de: 'Arbeitszeit', article: 'die', plural: 'Arbeitszeiten', en: 'working hours', type: 'noun', category: 'Arbeit' },
  { id: 'w028', de: 'Arzt', article: 'der', plural: 'Ärzte', en: 'doctor', type: 'noun', category: 'Gesundheit' },
  { id: 'w029', de: 'Aufgabe', article: 'die', plural: 'Aufgaben', en: 'task', type: 'noun', category: 'Alltag' },
  { id: 'w030', de: 'Aufenthalt', article: 'der', plural: 'Aufenthalte', en: 'stay', type: 'noun', category: 'Reisen' },
  { id: 'w031', de: 'Ausbildung', article: 'die', plural: 'Ausbildungen', en: 'vocational training', type: 'noun', category: 'Bildung' },
  { id: 'w032', de: 'Ausgang', article: 'der', plural: 'Ausgänge', en: 'exit', type: 'noun', category: 'Alltag' },
  { id: 'w033', de: 'Ausländer', article: 'der', plural: 'Ausländer', en: 'foreigner', type: 'noun', category: 'Gesellschaft' },
  { id: 'w034', de: 'Ausrede', article: 'die', plural: 'Ausreden', en: 'excuse', type: 'noun', category: 'Kommunikation' },
  { id: 'w035', de: 'Aussage', article: 'die', plural: 'Aussagen', en: 'statement', type: 'noun', category: 'Kommunikation' },
  { id: 'w036', de: 'Ausstellung', article: 'die', plural: 'Ausstellungen', en: 'exhibition', type: 'noun', category: 'Kultur' },
  { id: 'w037', de: 'Auto', article: 'das', plural: 'Autos', en: 'car', type: 'noun', category: 'Verkehr' },
  { id: 'w038', de: 'Autobahn', article: 'die', plural: 'Autobahnen', en: 'motorway', type: 'noun', category: 'Verkehr' },

  // B
  { id: 'w039', de: 'Bäckerei', article: 'die', plural: 'Bäckereien', en: 'bakery', type: 'noun', category: 'Einkaufen' },
  { id: 'w040', de: 'Bahnhof', article: 'der', plural: 'Bahnhöfe', en: 'train station', type: 'noun', category: 'Verkehr' },
  { id: 'w041', de: 'Bank', article: 'die', plural: 'Banken', en: 'bank', type: 'noun', category: 'Finanzen' },
  { id: 'w042', de: 'Beamte', article: 'der', plural: 'Beamten', en: 'civil servant', type: 'noun', category: 'Arbeit' },
  { id: 'w043', de: 'Bedeutung', article: 'die', plural: 'Bedeutungen', en: 'meaning', type: 'noun', category: 'Sprache' },
  { id: 'w044', de: 'Bedingung', article: 'die', plural: 'Bedingungen', en: 'condition', type: 'noun', category: 'Alltag' },
  { id: 'w045', de: 'Behörde', article: 'die', plural: 'Behörden', en: 'authority', type: 'noun', category: 'Behörde' },
  { id: 'w046', de: 'Beispiel', article: 'das', plural: 'Beispiele', en: 'example', type: 'noun', category: 'Sprache' },
  { id: 'w047', de: 'Beruf', article: 'der', plural: 'Berufe', en: 'profession', type: 'noun', category: 'Arbeit' },
  { id: 'w048', de: 'Beschreibung', article: 'die', plural: 'Beschreibungen', en: 'description', type: 'noun', category: 'Sprache' },
  { id: 'w049', de: 'Besuch', article: 'der', plural: 'Besuche', en: 'visit', type: 'noun', category: 'Soziales' },
  { id: 'w050', de: 'Bewerbung', article: 'die', plural: 'Bewerbungen', en: 'job application', type: 'noun', category: 'Arbeit' },
  { id: 'w051', de: 'Bibliothek', article: 'die', plural: 'Bibliotheken', en: 'library', type: 'noun', category: 'Bildung' },
  { id: 'w052', de: 'Bild', article: 'das', plural: 'Bilder', en: 'picture', type: 'noun', category: 'Kultur' },
  { id: 'w053', de: 'Bildung', article: 'die', plural: '', en: 'education', type: 'noun', category: 'Bildung' },
  { id: 'w054', de: 'Brief', article: 'der', plural: 'Briefe', en: 'letter', type: 'noun', category: 'Kommunikation' },
  { id: 'w055', de: 'Brot', article: 'das', plural: 'Brote', en: 'bread', type: 'noun', category: 'Essen' },
  { id: 'w056', de: 'Bruder', article: 'der', plural: 'Brüder', en: 'brother', type: 'noun', category: 'Familie' },
  { id: 'w057', de: 'Buch', article: 'das', plural: 'Bücher', en: 'book', type: 'noun', category: 'Bildung' },
  { id: 'w058', de: 'Büro', article: 'das', plural: 'Büros', en: 'office', type: 'noun', category: 'Arbeit' },
  { id: 'w059', de: 'Bus', article: 'der', plural: 'Busse', en: 'bus', type: 'noun', category: 'Verkehr' },

  // C
  { id: 'w060', de: 'Chance', article: 'die', plural: 'Chancen', en: 'chance', type: 'noun', category: 'Alltag' },
  { id: 'w061', de: 'Chef', article: 'der', plural: 'Chefs', en: 'boss', type: 'noun', category: 'Arbeit' },
  { id: 'w062', de: 'Computer', article: 'der', plural: 'Computer', en: 'computer', type: 'noun', category: 'Technik' },

  // D
  { id: 'w063', de: 'Datum', article: 'das', plural: 'Daten', en: 'date', type: 'noun', category: 'Zeit' },
  { id: 'w064', de: 'Deutsch', article: 'das', plural: '', en: 'German (language)', type: 'noun', category: 'Sprache' },
  { id: 'w065', de: 'Deutschland', article: 'das', plural: '', en: 'Germany', type: 'noun', category: 'Länder' },
  { id: 'w066', de: 'Dienstag', article: 'der', plural: 'Dienstage', en: 'Tuesday', type: 'noun', category: 'Zeit' },
  { id: 'w067', de: 'Donnerstag', article: 'der', plural: 'Donnerstage', en: 'Thursday', type: 'noun', category: 'Zeit' },
  { id: 'w068', de: 'Dorf', article: 'das', plural: 'Dörfer', en: 'village', type: 'noun', category: 'Wohnen' },
  { id: 'w069', de: 'Drucker', article: 'der', plural: 'Drucker', en: 'printer', type: 'noun', category: 'Technik' },

  // E
  { id: 'w070', de: 'Eingang', article: 'der', plural: 'Eingänge', en: 'entrance', type: 'noun', category: 'Alltag' },
  { id: 'w071', de: 'Einladung', article: 'die', plural: 'Einladungen', en: 'invitation', type: 'noun', category: 'Soziales' },
  { id: 'w072', de: 'Eltern', article: 'die', plural: 'Eltern', en: 'parents', type: 'noun', category: 'Familie' },
  { id: 'w073', de: 'E-Mail', article: 'die', plural: 'E-Mails', en: 'email', type: 'noun', category: 'Kommunikation' },
  { id: 'w074', de: 'Empfang', article: 'der', plural: 'Empfänge', en: 'reception', type: 'noun', category: 'Alltag' },
  { id: 'w075', de: 'Energie', article: 'die', plural: 'Energien', en: 'energy', type: 'noun', category: 'Umwelt' },
  { id: 'w076', de: 'Entscheidung', article: 'die', plural: 'Entscheidungen', en: 'decision', type: 'noun', category: 'Alltag' },
  { id: 'w077', de: 'Erfahrung', article: 'die', plural: 'Erfahrungen', en: 'experience', type: 'noun', category: 'Alltag' },
  { id: 'w078', de: 'Ergebnis', article: 'das', plural: 'Ergebnisse', en: 'result', type: 'noun', category: 'Alltag' },
  { id: 'w079', de: 'Erkältung', article: 'die', plural: 'Erkältungen', en: 'cold (illness)', type: 'noun', category: 'Gesundheit' },
  { id: 'w080', de: 'Ernährung', article: 'die', plural: '', en: 'nutrition', type: 'noun', category: 'Gesundheit' },
  { id: 'w081', de: 'Erwachsene', article: 'der', plural: 'Erwachsenen', en: 'adult', type: 'noun', category: 'Person' },

  // F
  { id: 'w082', de: 'Familie', article: 'die', plural: 'Familien', en: 'family', type: 'noun', category: 'Familie' },
  { id: 'w083', de: 'Farbe', article: 'die', plural: 'Farben', en: 'colour', type: 'noun', category: 'Alltag' },
  { id: 'w084', de: 'Fehler', article: 'der', plural: 'Fehler', en: 'mistake', type: 'noun', category: 'Sprache' },
  { id: 'w085', de: 'Feier', article: 'die', plural: 'Feiern', en: 'celebration', type: 'noun', category: 'Soziales' },
  { id: 'w086', de: 'Fenster', article: 'das', plural: 'Fenster', en: 'window', type: 'noun', category: 'Wohnen' },
  { id: 'w087', de: 'Ferien', article: 'die', plural: 'Ferien', en: 'holidays', type: 'noun', category: 'Reisen' },
  { id: 'w088', de: 'Film', article: 'der', plural: 'Filme', en: 'film', type: 'noun', category: 'Freizeit' },
  { id: 'w089', de: 'Firma', article: 'die', plural: 'Firmen', en: 'company', type: 'noun', category: 'Arbeit' },
  { id: 'w090', de: 'Fleisch', article: 'das', plural: '', en: 'meat', type: 'noun', category: 'Essen' },
  { id: 'w091', de: 'Flughafen', article: 'der', plural: 'Flughäfen', en: 'airport', type: 'noun', category: 'Verkehr' },
  { id: 'w092', de: 'Fluss', article: 'der', plural: 'Flüsse', en: 'river', type: 'noun', category: 'Natur' },
  { id: 'w093', de: 'Formular', article: 'das', plural: 'Formulare', en: 'form', type: 'noun', category: 'Behörde' },
  { id: 'w094', de: 'Frau', article: 'die', plural: 'Frauen', en: 'woman / wife', type: 'noun', category: 'Person' },
  { id: 'w095', de: 'Freizeit', article: 'die', plural: '', en: 'free time', type: 'noun', category: 'Freizeit' },
  { id: 'w096', de: 'Freund', article: 'der', plural: 'Freunde', en: 'friend', type: 'noun', category: 'Soziales' },
  { id: 'w097', de: 'Frühstück', article: 'das', plural: 'Frühstücke', en: 'breakfast', type: 'noun', category: 'Essen' },

  // G
  { id: 'w098', de: 'Gebäude', article: 'das', plural: 'Gebäude', en: 'building', type: 'noun', category: 'Wohnen' },
  { id: 'w099', de: 'Geburtstag', article: 'der', plural: 'Geburtstage', en: 'birthday', type: 'noun', category: 'Soziales' },
  { id: 'w100', de: 'Gefühl', article: 'das', plural: 'Gefühle', en: 'feeling', type: 'noun', category: 'Gefühle' },
  { id: 'w101', de: 'Gehalt', article: 'das', plural: 'Gehälter', en: 'salary', type: 'noun', category: 'Arbeit' },
  { id: 'w102', de: 'Gemüse', article: 'das', plural: 'Gemüse', en: 'vegetables', type: 'noun', category: 'Essen' },
  { id: 'w103', de: 'Gepäck', article: 'das', plural: '', en: 'luggage', type: 'noun', category: 'Reisen' },
  { id: 'w104', de: 'Geschwister', article: 'die', plural: 'Geschwister', en: 'siblings', type: 'noun', category: 'Familie' },
  { id: 'w105', de: 'Gesellschaft', article: 'die', plural: 'Gesellschaften', en: 'society', type: 'noun', category: 'Gesellschaft' },
  { id: 'w106', de: 'Gesetz', article: 'das', plural: 'Gesetze', en: 'law', type: 'noun', category: 'Politik' },
  { id: 'w107', de: 'Gesundheit', article: 'die', plural: '', en: 'health', type: 'noun', category: 'Gesundheit' },
  { id: 'w108', de: 'Gewicht', article: 'das', plural: 'Gewichte', en: 'weight', type: 'noun', category: 'Gesundheit' },
  { id: 'w109', de: 'Gewinn', article: 'der', plural: 'Gewinne', en: 'profit / prize', type: 'noun', category: 'Finanzen' },
  { id: 'w110', de: 'Glas', article: 'das', plural: 'Gläser', en: 'glass', type: 'noun', category: 'Essen' },
  { id: 'w111', de: 'Glück', article: 'das', plural: '', en: 'luck / happiness', type: 'noun', category: 'Gefühle' },
  { id: 'w112', de: 'Grenze', article: 'die', plural: 'Grenzen', en: 'border', type: 'noun', category: 'Gesellschaft' },
  { id: 'w113', de: 'Grund', article: 'der', plural: 'Gründe', en: 'reason', type: 'noun', category: 'Alltag' },
  { id: 'w114', de: 'Gruppe', article: 'die', plural: 'Gruppen', en: 'group', type: 'noun', category: 'Soziales' },

  // H
  { id: 'w115', de: 'Haushalt', article: 'der', plural: 'Haushalte', en: 'household', type: 'noun', category: 'Wohnen' },
  { id: 'w116', de: 'Heimat', article: 'die', plural: '', en: 'homeland', type: 'noun', category: 'Gesellschaft' },
  { id: 'w117', de: 'Hilfe', article: 'die', plural: 'Hilfen', en: 'help', type: 'noun', category: 'Alltag' },
  { id: 'w118', de: 'Hobby', article: 'das', plural: 'Hobbys', en: 'hobby', type: 'noun', category: 'Freizeit' },
  { id: 'w119', de: 'Hochschule', article: 'die', plural: 'Hochschulen', en: 'university', type: 'noun', category: 'Bildung' },
  { id: 'w120', de: 'Hotel', article: 'das', plural: 'Hotels', en: 'hotel', type: 'noun', category: 'Reisen' },
  { id: 'w121', de: 'Hunger', article: 'der', plural: '', en: 'hunger', type: 'noun', category: 'Gesundheit' },

  // I
  { id: 'w122', de: 'Information', article: 'die', plural: 'Informationen', en: 'information', type: 'noun', category: 'Kommunikation' },
  { id: 'w123', de: 'Inhalt', article: 'der', plural: 'Inhalte', en: 'content', type: 'noun', category: 'Sprache' },
  { id: 'w124', de: 'Integration', article: 'die', plural: 'Integrationen', en: 'integration', type: 'noun', category: 'Gesellschaft' },
  { id: 'w125', de: 'Internet', article: 'das', plural: '', en: 'internet', type: 'noun', category: 'Technik' },

  // J
  { id: 'w126', de: 'Jahr', article: 'das', plural: 'Jahre', en: 'year', type: 'noun', category: 'Zeit' },
  { id: 'w127', de: 'Jahreszeit', article: 'die', plural: 'Jahreszeiten', en: 'season', type: 'noun', category: 'Natur' },
  { id: 'w128', de: 'Job', article: 'der', plural: 'Jobs', en: 'job', type: 'noun', category: 'Arbeit' },
  { id: 'w129', de: 'Jugendliche', article: 'der', plural: 'Jugendlichen', en: 'young person', type: 'noun', category: 'Person' },

  // K
  { id: 'w130', de: 'Kalender', article: 'der', plural: 'Kalender', en: 'calendar', type: 'noun', category: 'Zeit' },
  { id: 'w131', de: 'Kassierer', article: 'der', plural: 'Kassierer', en: 'cashier', type: 'noun', category: 'Arbeit' },
  { id: 'w132', de: 'Kellner', article: 'der', plural: 'Kellner', en: 'waiter', type: 'noun', category: 'Arbeit' },
  { id: 'w133', de: 'Kind', article: 'das', plural: 'Kinder', en: 'child', type: 'noun', category: 'Familie' },
  { id: 'w134', de: 'Kino', article: 'das', plural: 'Kinos', en: 'cinema', type: 'noun', category: 'Freizeit' },
  { id: 'w135', de: 'Kleidung', article: 'die', plural: 'Kleidungen', en: 'clothing', type: 'noun', category: 'Einkaufen' },
  { id: 'w136', de: 'Klimawandel', article: 'der', plural: '', en: 'climate change', type: 'noun', category: 'Umwelt' },
  { id: 'w137', de: 'Kollege', article: 'der', plural: 'Kollegen', en: 'colleague', type: 'noun', category: 'Arbeit' },
  { id: 'w138', de: 'Kosten', article: 'die', plural: 'Kosten', en: 'costs', type: 'noun', category: 'Finanzen' },
  { id: 'w139', de: 'Krankenhaus', article: 'das', plural: 'Krankenhäuser', en: 'hospital', type: 'noun', category: 'Gesundheit' },
  { id: 'w140', de: 'Krankheit', article: 'die', plural: 'Krankheiten', en: 'illness', type: 'noun', category: 'Gesundheit' },
  { id: 'w141', de: 'Kredit', article: 'der', plural: 'Kredite', en: 'loan', type: 'noun', category: 'Finanzen' },
  { id: 'w142', de: 'Küche', article: 'die', plural: 'Küchen', en: 'kitchen', type: 'noun', category: 'Wohnen' },
  { id: 'w143', de: 'Kurs', article: 'der', plural: 'Kurse', en: 'course', type: 'noun', category: 'Bildung' },

  // L
  { id: 'w144', de: 'Land', article: 'das', plural: 'Länder', en: 'country', type: 'noun', category: 'Länder' },
  { id: 'w145', de: 'Landschaft', article: 'die', plural: 'Landschaften', en: 'landscape', type: 'noun', category: 'Natur' },
  { id: 'w146', de: 'Lebensmittel', article: 'die', plural: 'Lebensmittel', en: 'food / groceries', type: 'noun', category: 'Essen' },
  { id: 'w147', de: 'Lehrer', article: 'der', plural: 'Lehrer', en: 'teacher', type: 'noun', category: 'Bildung' },
  { id: 'w148', de: 'Lösung', article: 'die', plural: 'Lösungen', en: 'solution', type: 'noun', category: 'Alltag' },
  { id: 'w149', de: 'Luft', article: 'die', plural: '', en: 'air', type: 'noun', category: 'Natur' },

  // M
  { id: 'w150', de: 'Mahlzeit', article: 'die', plural: 'Mahlzeiten', en: 'meal', type: 'noun', category: 'Essen' },
  { id: 'w151', de: 'Mann', article: 'der', plural: 'Männer', en: 'man / husband', type: 'noun', category: 'Person' },
  { id: 'w152', de: 'Markt', article: 'der', plural: 'Märkte', en: 'market', type: 'noun', category: 'Einkaufen' },
  { id: 'w153', de: 'Medikament', article: 'das', plural: 'Medikamente', en: 'medicine', type: 'noun', category: 'Gesundheit' },
  { id: 'w154', de: 'Meinung', article: 'die', plural: 'Meinungen', en: 'opinion', type: 'noun', category: 'Kommunikation' },
  { id: 'w155', de: 'Miete', article: 'die', plural: 'Mieten', en: 'rent', type: 'noun', category: 'Wohnen' },
  { id: 'w156', de: 'Mitglied', article: 'das', plural: 'Mitglieder', en: 'member', type: 'noun', category: 'Soziales' },
  { id: 'w157', de: 'Mittag', article: 'der', plural: 'Mittage', en: 'midday', type: 'noun', category: 'Zeit' },
  { id: 'w158', de: 'Möbel', article: 'die', plural: 'Möbel', en: 'furniture', type: 'noun', category: 'Wohnen' },
  { id: 'w159', de: 'Monat', article: 'der', plural: 'Monate', en: 'month', type: 'noun', category: 'Zeit' },
  { id: 'w160', de: 'Morgen', article: 'der', plural: 'Morgen', en: 'morning', type: 'noun', category: 'Zeit' },
  { id: 'w161', de: 'Müll', article: 'der', plural: '', en: 'rubbish / waste', type: 'noun', category: 'Umwelt' },
  { id: 'w162', de: 'Mutter', article: 'die', plural: 'Mütter', en: 'mother', type: 'noun', category: 'Familie' },

  // N
  { id: 'w163', de: 'Nachbar', article: 'der', plural: 'Nachbarn', en: 'neighbour', type: 'noun', category: 'Wohnen' },
  { id: 'w164', de: 'Nachrichten', article: 'die', plural: 'Nachrichten', en: 'news', type: 'noun', category: 'Medien' },
  { id: 'w165', de: 'Nacht', article: 'die', plural: 'Nächte', en: 'night', type: 'noun', category: 'Zeit' },
  { id: 'w166', de: 'Name', article: 'der', plural: 'Namen', en: 'name', type: 'noun', category: 'Person' },
  { id: 'w167', de: 'Nummer', article: 'die', plural: 'Nummern', en: 'number', type: 'noun', category: 'Alltag' },

  // O
  { id: 'w168', de: 'Obst', article: 'das', plural: '', en: 'fruit', type: 'noun', category: 'Essen' },
  { id: 'w169', de: 'Öffentlichkeit', article: 'die', plural: '', en: 'public', type: 'noun', category: 'Gesellschaft' },
  { id: 'w170', de: 'Öffnungszeiten', article: 'die', plural: 'Öffnungszeiten', en: 'opening hours', type: 'noun', category: 'Alltag' },
  { id: 'w171', de: 'Ordnung', article: 'die', plural: 'Ordnungen', en: 'order / tidiness', type: 'noun', category: 'Alltag' },
  { id: 'w172', de: 'Ort', article: 'der', plural: 'Orte', en: 'place', type: 'noun', category: 'Alltag' },

  // P
  { id: 'w173', de: 'Paket', article: 'das', plural: 'Pakete', en: 'parcel', type: 'noun', category: 'Kommunikation' },
  { id: 'w174', de: 'Park', article: 'der', plural: 'Parks', en: 'park', type: 'noun', category: 'Freizeit' },
  { id: 'w175', de: 'Pass', article: 'der', plural: 'Pässe', en: 'passport', type: 'noun', category: 'Behörde' },
  { id: 'w176', de: 'Pause', article: 'die', plural: 'Pausen', en: 'break', type: 'noun', category: 'Arbeit' },
  { id: 'w177', de: 'Person', article: 'die', plural: 'Personen', en: 'person', type: 'noun', category: 'Person' },
  { id: 'w178', de: 'Platz', article: 'der', plural: 'Plätze', en: 'square / seat', type: 'noun', category: 'Alltag' },
  { id: 'w179', de: 'Politik', article: 'die', plural: '', en: 'politics', type: 'noun', category: 'Politik' },
  { id: 'w180', de: 'Post', article: 'die', plural: '', en: 'post office / mail', type: 'noun', category: 'Kommunikation' },
  { id: 'w181', de: 'Preis', article: 'der', plural: 'Preise', en: 'price', type: 'noun', category: 'Finanzen' },
  { id: 'w182', de: 'Problem', article: 'das', plural: 'Probleme', en: 'problem', type: 'noun', category: 'Alltag' },
  { id: 'w183', de: 'Prüfung', article: 'die', plural: 'Prüfungen', en: 'exam', type: 'noun', category: 'Bildung' },

  // R
  { id: 'w184', de: 'Rat', article: 'der', plural: 'Ratschläge', en: 'advice', type: 'noun', category: 'Kommunikation' },
  { id: 'w185', de: 'Rechnung', article: 'die', plural: 'Rechnungen', en: 'bill / invoice', type: 'noun', category: 'Finanzen' },
  { id: 'w186', de: 'Recht', article: 'das', plural: 'Rechte', en: 'right / law', type: 'noun', category: 'Politik' },
  { id: 'w187', de: 'Reise', article: 'die', plural: 'Reisen', en: 'journey', type: 'noun', category: 'Reisen' },
  { id: 'w188', de: 'Rezept', article: 'das', plural: 'Rezepte', en: 'recipe / prescription', type: 'noun', category: 'Gesundheit' },
  { id: 'w189', de: 'Ruhe', article: 'die', plural: '', en: 'quiet / calm', type: 'noun', category: 'Alltag' },

  // S
  { id: 'w190', de: 'Satz', article: 'der', plural: 'Sätze', en: 'sentence', type: 'noun', category: 'Sprache' },
  { id: 'w191', de: 'Schule', article: 'die', plural: 'Schulen', en: 'school', type: 'noun', category: 'Bildung' },
  { id: 'w192', de: 'Schwester', article: 'die', plural: 'Schwestern', en: 'sister', type: 'noun', category: 'Familie' },
  { id: 'w193', de: 'Sicherheit', article: 'die', plural: '', en: 'safety / security', type: 'noun', category: 'Gesellschaft' },
  { id: 'w194', de: 'Sprache', article: 'die', plural: 'Sprachen', en: 'language', type: 'noun', category: 'Sprache' },
  { id: 'w195', de: 'Staat', article: 'der', plural: 'Staaten', en: 'state', type: 'noun', category: 'Politik' },
  { id: 'w196', de: 'Stadt', article: 'die', plural: 'Städte', en: 'city', type: 'noun', category: 'Wohnen' },
  { id: 'w197', de: 'Stelle', article: 'die', plural: 'Stellen', en: 'position / job', type: 'noun', category: 'Arbeit' },
  { id: 'w198', de: 'Strom', article: 'der', plural: 'Ströme', en: 'electricity', type: 'noun', category: 'Wohnen' },
  { id: 'w199', de: 'Stunde', article: 'die', plural: 'Stunden', en: 'hour', type: 'noun', category: 'Zeit' },
  { id: 'w200', de: 'Suche', article: 'die', plural: 'Suchen', en: 'search', type: 'noun', category: 'Alltag' },
];

export const CATEGORIES = [...new Set(WORDS.map(w => w.category).filter(Boolean))] as string[];
