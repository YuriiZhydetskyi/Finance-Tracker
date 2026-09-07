# Інвентар унікальних товарів

**Дата зрізу:** 7 вересня 2026 року  
**Джерело:** linked Supabase production database, read-only SQL  
**Покриття:** 182 чеків, 1 296 рядків товарів, 652 унікальні нормалізовані назви.

## Як читати цей список

- Первинним джерелом є `public.items.product_name`: це історичний snapshot назви в чеку, тому список не втрачає покупки, яких немає в поточному довіднику.
- Нормалізація об'єднує лише відмінності регістру, пробілів і країв рядка. Оригінальні варіанти в одній нормалізованій назві показані через `/`.
- Розділи — поточні широкі категорії на рядках чеків. Якщо одна нормалізована назва траплялась у кількох таких категоріях, вони показані разом у заголовку; це дані для ручного рішення, а не автоматичне злиття.
- Позначка _has an unlinked historical line_ означає, що хоча б один рядок цієї назви не має `product_id`. Нижче ці 37 назв винесені окремо.
- У списку є не лише харчі: Pfand, знижки, послуги, Amazon-покупки та інші позиції також є фактично залогованими рядками.

## Метод

Запит групує `items.product_name` за `lower(trim(collapse-whitespace(name)))`, залишає оригінальні написання для огляду та додає поточну `items.category` і наявність `product_id`. Жодних таблиць або файлів бази не змінювали.

## Pfand

- Eigemarke: Pfand
- Eigenmarke: Pfand
- LEERG. MW V. ST
- Leerg.Entl.erm.EW
- Leergut Einw.allg. _(has an unlinked historical line)_
- LEERGUT EINWEG
- Leergut Entl.allg. _(has an unlinked historical line)_
- Leergut Entl.erm.
- Pfand _(has an unlinked historical line)_
- PFAND 0,08 EUR
- PFAND 0,15 EUR
- PFAND 0,25 EURO
- Pfand 0,25 M
- Pfand 2,25 EM

## Авто

- 150 x 80 cm Large Parasol Car, Car Sun Protection Windscreen Foldable UV Protection Parasol for the Windscreen for Most Cars
- RAVENOL MTF-1 SAE 75W-85
- SCHEIBENREINIGER
- Super E5

## Алкоголь

- Bitburger0,0 330ml
- deit Pink Gr.0,75l
- Erd.Weißb.AF 0,5l
- ERD.WEISSB.ALKFR
- ERDINGER ALK.FRE
- Franz.Weizen 0,5l
- Gaffels Fa.6x0,33l
- Kromb.Himbee.0,33l
- Kromb.Kirsche0,33l
- L.Live Red 0,75l
- Marmorini Rose
- Mayb.Rose AF 0,75l _(has an unlinked historical line)_
- Mayb.Weiß AF0,75l _(has an unlinked historical line)_
- MUMM ALKOHOLFREI
- Pau.Weißb.Z.0,33l _(has an unlinked historical line)_
- Paul.WB af.0,5l
- Paul.Weiß.af.
- Paul.Weißb.Z.0,5l
- Rosso Alkoholfrei
- Tir.Felsenkellerk.

## Алкоголь / Бакалія

- Bened.Weiz.AF 0,5l
- Paul.Weiß.af.0,5l _(has an unlinked historical line)_

## Алкоголь / Інше

- Stolzen.alkfr.weiß

## Аптека

- CERAVE FEUCHTIGKEITSCREME
- Clabin plus 15 ml
- Iodine Selenium Complex I 180 Thyroid Capsules
- Iron Tablets High Dose 365x with 20 mg Iron + Vitamin C (20 mg) from Rose Hips - Bioavailable Iron Bisglycinate + Natural Vitamin C from Rosehip Extract - Laboratory Tested with Certificate
- Magnesium Complex 180 Capsules, 400 mg Elemental Per Day, 5 High-Quality Forms: Magnesium Oxide, Citrate, Bisglycinate, Malate & Ascorbate, Optimal Bioavailability, 3 Month Supply
- Magnesium Complex 540 Capsules - 400 mg Elementary Magnesium per Day, 5 High-Quality Forms: Mag. Oxide, Citrate, Bisglycinate, Malate & Ascorbate - Optimal Bioavailability - Laboratory Tested with Certificate
- Medrull Medical Gauze Large 90 cm x 10 m Premium Gauze Bandages Fixing Bandages
- Mivolis Magnesium Tabl. 300St
- Mivolis Multivi-Bärchen Kinder
- Mivolis Multivitamin Gummies
- Mivolls Magnesium Tabl. 300St
- Mivolls Pflaster-strip
- Weightworld Naticol Collagen Capsules, 1170 mg, Pure Marine Collagen, 120 Capsules, Hydrolysate Type 1, Laboratory Tested in Germany, with Pure Collagen Protein Powder

## Бакалія

- AJI-NO-MOTO - Monosodium Glutamate (1 x 1 kg)
- albi Birnensaft 1l
- albi Pink Grape.1l
- Amecke Apf.Birne1l
- Amecke Apf.Birneli
- Ananas Scheiben
- Apfeldirektsaft 1l
- Apfelsaft 1,5l
- Barilla Penne
- Barilla Pesto
- Barilla Spaghetti
- Basmati Reis
- Bio Al.Haferflock.
- Bio Allos Creamy _(has an unlinked historical line)_
- Bio El Or.Chips
- Bio Honig Dostersp
- Bio Hummus 175g
- Bio Koro Erdnu.Mus
- CC ZERO EW 1,5
- Coca-Cola 2l / Coca-Cola 2L
- Coca-Cola Ch.1,25l
- Coupon Heinz
- EGEN CherryRispto.
- Erdnussbutter
- Espresso Trad. 1kg
- FARMER Nuss-Mix
- Franz.af.6x0,33l
- G&G Erythrit
- G&G F.Blättertei.
- G&G MiWa st.6x1,5l _(has an unlinked historical line)_
- G&G Partypicker
- G&G Spezi.Salz
- G&G Stap.Chip.Salz
- Gaffel Brause0,33l
- Getr.Cranberries
- Günth.Goldfont.
- Harry Sandwich _(has an unlinked historical line)_
- HD Ananas 1l
- Healthy Boy Fish Sauce, 700 ml (Pack of 1)
- HEILWASSER STILL
- Heinz Barbecue Sa.
- Heinz Ketchup
- Herz.Bruschet.Dip
- Herz.Bulgur
- Herz.Kolumb.Kaff.
- Herz.La.Bri.Buns
- Hohes C Eisen 1l _(has an unlinked historical line)_
- Hom.Hot Dog Sauce
- HSN - Soy Protein Isolate | Vegan Protein | Vegan Protein with Stevia | Soy
- Hummus High Pro
- Just Spices Italian
- Kattus Worcester Sauce 140ml
- Kühne Steak Sauce
- Lay's Chips 150g
- Lea & Perrins - Pack of 3 Original Worcestershire Sauce in 150 ml Glass Bottle (Seasoning Sauce) - Traditional English Worcester Worcester Sauce
- Leicht&Cross
- Lie.Urk.Prot.Brot
- Medusa Antipasti
- Meggle Baguette _(has an unlinked historical line)_
- Mineralwasser still
- Nest.Fitn.Cereal
- Northy Remoulade
- Nuss-Mix 150g
- ORIGINAL
- Paul.WB af.0,33l
- Paul.Weiß.Z.0,5l
- PBN micellar casein protein PBN4023 1 kg vanilla
- Pistazien
- Porcini Mushroom Powder 200 g I Porcini Mushrooms I Natural I Ground I Porcini Mushrooms Dried
- PRING. MAPLE BBQ
- Pringles 185g
- PRINGLES FRIES
- PRINGLES WINGS
- Red Bull Energy
- Reibekuchen
- Rockstar Xdurance
- S&R Olive Oil
- Schwartau Spezial.
- Sonnenblumenöl 1L
- Sonnenmais 425ml
- SOUR CREAM&ONION
- Span. Oliven entst
- SWEET PAPRIKA
- Tagliatelle 500g
- Traubendirektsa 1l
- Ultje Erdnusse
- Vitamalz 0,5l
- Vollkorn-Sandwich
- WACHTELEIER
- Walnusskerne
- Wildpreiselbeeren
- Wraps Vollkorn
- XXL Cashewkerne
- XXL Studentenf.
- Zit.-/Ora.schale
- Zucker - Raffinade
- Zuckermals 400g va

## Бакалія / Інше

- CC Light/Zero
- Coke Zero 1,25l _(has an unlinked historical line)_
- Multivitamin 1l
- Val. Orange 1l

## Бакалія / Інше / Молочка

- EIFEL Eier FlH / EIFEL Eier FLH _(has an unlinked historical line)_

## Бакалія / Молочка

- G.Clar.Eier FLH

## Бакалія / Овочі/фрукти / Солодке

- Bond.Familiy-Mix _(has an unlinked historical line)_
- Herz.Honey Peppers

## Бакалія / Солодке

- Cashews
- Erdn. 200g Beutel
- Lays Gesalzen _(has an unlinked historical line)_
- Stapelchips

## Дім і ремонт

- Fine Mesh Wire Mesh 40 cm x 5 m Vole Mesh for Raised Bed Wire Mesh Roll Galvanised Mesh Width 6 mm Wire Mesh as Rabbit Wire Aviary Wire Rabbit Wire Chicken Wire Rabbit Wire
- GOLDEN ICEPURE Water Filter Cartridges Compatible with Brita Maxtra+ Plus Maxtra Pro All-in-1, Water Filter Cartridges Replacement for Mavea, Anna Duomax, Filtration for Limescale Removal, Pack of 9
- Heat Resistant Silicone Kitchen Tongs: U-Taste 315°C Heat Resistant Cooking Tongs Set with Firmly Sealed Non-Stick Rubber Tips and Silicone-Coated Stainless Steel Handle (23/30 cm, Aqua Sky)
- KTCHENDAO 2-in-1 Glass Salt Shaker with Side Spout, Salt Shaker with Lid, Built-in Lid to Slow Moisture with Measurement Markings, BPA-Free, 4 oz (White)
- Philips Domestic Appliances PSG6064/80 Steam Iron, Gold, 600 g Steam Boost
- Pleated Blind, No Drilling Required, Klemmfix, 100 x 110 cm (L x W), White Blind, Sun Protection Easyfix Folding Blind, Translucent Roller Blind for Windows and Doors
- shinfly Felt Desk Mat, 120 x 60 cm, Desk Mat, Non-Slip Desk Mat, Office Desktop Protection, Desk Mat for Home Office Equipment (Grey)
- Spice rack without drilling clips, spice organiser for gluing, 6 strips for 30 spices
- ThermoMaven F1 Turbo Digital Meat Thermometer - 0.5s Instant Display Grill Thermometer, ±0.3°C Accurate Thermometer Cooking, IP67 Waterproof Magnetic Thermometer Cooking, Bottle Opener Roasting BBQ Grill
- Vielit Satin Pillowcases, Set of 2, 40 x 60 cm, Beige, Soft as Silk, Easy-Care, for Hair and Skin, Comes with 2 Scrunchies
- Weber 17612 Lighting Cubes, Brown, Without Additives, Pack of 48
- Weber Metal Fireplace
- Yarall 32 Stück Verschlussclips für Lebensmittel, gebogenes Design, Kunststoff Verschlussklammern und Tütenclips, Clips für Tüten in 2 Größen – 11 cm ×20 & 8 cm ×12

## Електроніка

- Anker 100 W USB C Charger, Laptop Charger, Compact 3-Port GaN Wall Charger, Smart Display, Touch Control, for MacBook, iPad, iPhone 17/16/15 Series (USB-C Cable Included)
- Anker Zolo 50 W USB C Charger, 4-Port Power Supply with 2 USB-C and 2 USB-A, Compact Fast Charger for iPhone 17 Pro Max/16/15/14/13 Series, iPad, Pixel, Galaxy, MacBook (without Cable)
- Anker Zolo Powerbank (2025 Upgrade), 20000 mAh, 30 W High-Speed Charger with Integrated USB-C Cable, Battery Pack for iPhone 17/16/15 Series, Galaxy and More
- Apple 13 inch MacBook Air Laptop, M5 Chip with 10-Core CPU and 8-Core GPU: Designed for AI, 13.6-inch Liquid Retina Display, 16GB Shared Memory, 512GB SSD, Touch ID, WiFi 7; Midnight
- ARCTIC 4-Pin PWM Fan Splitter Cable, PST Splitter Cable for 4 Fans
- be quiet! Power Zone 2 750W PC Power Supply, 80 Plus and Cybenetics Platinum
- Duracell Specialty 2032 Lithium Button Batteries 3 V Pack of 4 with Child Safe Technology for use in Keychains, Scales, Wearables and Medical Devices (CR2032 /DL2032)
- EXTRASTAR 3-Way Socket Adapter, 2 Euro + 1 Schuko, EU Plug Adapter with Child Lock, Power Strip for Office, Home, White (Pack of 1)
- Hersmay PK-NEX Lens Adapter for Pentax PK K Lens Suitable for Sony E-Mount NEX5 NEX6 NEX7 A7 I II III IV A7S A7R A7SII A7SIII A7RII A6500 A6300 A6000 A5100 A5000 NEX-FS700 VGG 30 VG99 00 PXW-FS7
- Logitech ERGO K860 - Wireless ergonomic keyboard with split buttons, wristwear and support for natural tap - Windows / Mac, Bluetooth, USB receiver, QWERTZ layout graphite
- Logitech MX Vertical, Ergonomic Wireless Mouse, Bluetooth and 2.4 GHz connection via Unifying USB receiver, 4000 dpi sensor, Rechargeable Battery, 4 buttons, multi-device, PC / Mac / iPadOS - Black
- Noctua NF-A12x25 G2 PWM Quiet High Performance Fan 120 mm
- Noctua NF-A12x25 G2 PWM Sx2-PP, Quiet High Performance Fan 2 x 120 mm
- Sapphire Technology Carte Graphique Nitro Plus AMD Radeon RX 9060 XT Gaming OC 16GB Double HDMI-DP
- UGREEN 2.4G & Bluetooth Mouse Wireless Vertical Ergonomic Mouse for Windows/Mac OS etc. 1000/1600/2000/4000 DPI, 6 Buttons (2.4G + BT 5.4)

## Інтимні товари

- Durex Performa Condoms, Sex-Prolonging Condoms with 5% Benzocaine Gel and Easy-On Shape, Pack of 12 (1 x 12 Condoms)
- Durex Performa Condoms, Sex-Prolonging Condoms with 5% Benzocaine Gel for Longer-Lasting Sexual Pleasure, Pack of 36 (3 x 12 Condoms)
- Lubido Original water-based lubricant without parabens, jumbo 500 ml (pack of 2)

## Інше

- Akazienholz Sort.
- AvanC.Servietten
- Bambus Set
- CC Li/Ze 6x1.25l
- Design Servietten
- EZH Anzünder
- Fack.Bambussticks
- Fra.Sommerblumen
- Fuchst.Haargummis
- G&G Holzk.Briketts
- Grillholzkohle 3kg
- HP Mousse 200g
- JES Dekobutton
- JES Fleischspieße
- JES Geburt.kerzen
- JES Girlande
- JES Haarkralle
- JES Löffelablage
- JES Partyhüte
- JES Rotorspirale
- JES Schaschliksp.
- Knotenbeutel
- Kopierpapier
- Küchenartikel
- Lebensmittel
- Marlboro Red XL
- Obstknotenbeutel
- Pflanzen allg.
- Seitenb.Düsis
- Tiefkühltrageta.
- Tragetasche
- Tragetasche Altp
- Trinkhalme
- Zeitschrift.erm.

## Кафе/ресторани

- 0,2 Coca Cola Zer
- Beilagen-Pommes
- Cheeseburger
- Herz.VK Sandwich
- Яблучний штрудель, полуничний пиріг, американо з вершками, чай

## М'ясо/риба

- Bio E.Forellenfil.
- Bio E.Hähn.Lyoner
- BIO NL Kochschink.
- Bio Sommersteak
- Bio-Schweinefilet
- Bond.Salatmi.Ital.
- Bretteljause
- Dorade
- elGusto Ja.Serrano
- F&G Hüftsteak
- F&G Rd. Rump. gew.
- Foll.Thunfisch
- Forellenfilets
- G&G Nacken-S.
- G&G Partygarnelen
- G&G Räucherlachs
- G&G Stremellachs
- Garnelen ASC Prov.
- Garnelen Sort. XXL
- Garnelen-Sortiment
- H.FLUEGEL GEW.
- Hackfl. gem. XXL
- Hähn. Brustf. XXL
- Hähn. Minutenschn
- Hahn. Schwenkst.
- Hähn. Schwenkst.
- Hähnchensteaks, ma
- Handgelegter Koch.
- Handl Leich.Karree
- Haw.Heringsfilets
- Herzh. Gef./Rinds
- HF3 Minutensteaks
- HF3 Schnitzel
- Holzfällersteaks
- Lachsfiletseite750
- Lachsforellenfilet
- Lachsseite XXL
- Lamm Medaillons
- Lysell Deut.Kaviar
- Mar. Garnelen 200g
- METZGERSCHIN
- Nackensteaks, mar
- Nackensteaks, mar.
- Norweg. Lachsfilet
- Prosciutto Crudo
- Rabatt
- Rabattaktion HF 3 Rind Rumps
- Rabattaktion QS: FF Schwein
- Räucherl. 200g
- Rinderleber
- Sardellenfilets
- Schw. Minutensteak
- Schweine-Leber
- Schweinefilet
- Schweinefilet vak.
- Schwenksteaks
- Serrano Schinken S
- SG Seelachsfilet Natur 400g
- Simmentaler Steaks
- Speisefrühk. 2kg
- Steinhaus Braten
- SW-HUEFT. TO.BAE
- SW-RUECKEN GARLI
- SW-RUECKEN PAPRI
- T-Bone Steak
- Vici Meeres Snacks _(has an unlinked historical line)_
- Vici Surimi Sticks _(has an unlinked historical line)_
- White Tiger Gar.
- Wilken Butterfisch

## Молочка

- Alpro Bar.Drink 1l _(has an unlinked historical line)_
- Alpro Mandeldrink
- Alpro Soya Drink _(has an unlinked historical line)_
- Alpro Soya Drink1l
- Bärenm.Fr.Milch
- Bavaria Blu Käse
- BBQ Grillkaese
- BBQ Grillkäse
- Bio Alna.Speisequ.
- Bio E.Hu.Hahn Eier
- Bio Lehnertz Eier
- Bio PNL FriMil.3,8
- Bio PNL Quark 250g
- Brat u.Grillkaese
- Brebicet
- Brie 200g
- Brie Minitorte
- Brugge Alt _(has an unlinked historical line)_
- Buffalm. Minis 150
- Burrata 125g
- Camemb L Aromatiqu
- Cast.Ricotta
- Chaumes Klassik
- Dovgan Fam.2,5% Fett
- Dovgan Fam.33% Fett
- E.Gen.Creme Brulee
- EIFEL Eier Fl.
- Exqu.Frischk.fitl.
- Exqu.Frischk.Natur
- Feta / Schafskäse
- FH EIER 10ER
- Frau Antje Butter
- Frz. Camembert
- G.Clar.Eier F
- G&G ESL-Milch
- G&G Fettarm.Kefir
- G&G Jogh.griech.
- G&G Joghurt grie.
- G&G Mozzarella _(has an unlinked historical line)_
- G&G Zi.Käserolle
- Galb.Mascarpone
- Galb.Mozzarella _(has an unlinked historical line)_
- Geramont Crem
- Geramont Cremig
- Geramont Mix
- Gerv.Hüttenkäse
- Gervais HK 200g
- Gorgonzola
- Gouda jung
- Greco Feta, 150g
- Griech. Joghurt 2%
- Hennes Eier
- Herz.Camembert
- Herz.Mozzarella
- Herz.Skyr
- Herz.Weidemilch
- HP Fruity 8-Pack
- ital. Käsescheiben / Ital. Käsescheiben
- Joghurt gr Art 1kg
- Kefir 500 g
- Kerry.Kr.Kn.Butter
- Kerryg.Butter
- Kerrygold Butter _(has an unlinked historical line)_
- Landl.Frischmilch
- Landliebe F-Weidem
- LANDMILCH 3,8%
- M.Land Vollmilch
- MASCARPONE 40%
- Milr.Butterm.Quark
- Milr.Kefir Drink
- Milr.Speisequark
- MinusL ESL Milch
- Moya Sem.Zopfkäse
- Mozzarella
- Mozzarella Classic
- Mozzarella, ger.
- Naturjoghurt 1kg
- Parmigiano Reggiano
- Petit Camembert _(has an unlinked historical line)_
- Philadelphia
- Philadelphia FK
- Pres Meersalzbutte
- Quarki Quark FK 250g
- Reibek. Li. 250g
- Salakis Schafkäse
- Saure Sahne 200g
- Schlagsahne 200g
- SO LEICHT NATUR
- Tete de Moine
- Tuffi Heimatmilch
- Vollmilch 3,5 %
- Weih.Milch
- Ziegenk. 250g

## Молочка / Овочі/фрукти

- Bio E.Speiseq

## Овочі/фрукти

- 229496 Plattnektarine500g
- 231292 Frühkart.Vwfk2.5kg
- 2E Kiwis Gold
- 309604 Cocktailtom. 500g
- Aepfel 2kg VKE QS
- Albi Mutlivitam.1l
- Ananas Mini-Pack
- Apfel Pink Lady
- Apfel rot
- Äpfel rot
- Aprikosen Prem los
- Avocado Stk
- Bananen
- Bananen Bio
- Bananen FairTrade
- Bananen RFA
- BASILIKUM BIO
- Bio Auberginen _(has an unlinked historical line)_
- Bio Edeka Bananen _(has an unlinked historical line)_
- Bio Gemüsesortim.
- Bio GemüsesortIm.A
- Bio ML Gartenkress
- Bio Zitrone/Limett
- Bio-Zucchini 500g
- BIOE Zwiebeln
- Biol.Topfk.Basilikum
- Birne Abate lose
- Birne Agate lose
- Birnen
- Bond.Salat
- Bonduelle Salat
- Brokkoli 500g
- Brombeeren
- Brombeeren 125g
- Cherryrispentomate
- CHERRYROMATOMATE
- Cocktailtom. 500g
- DattelNaschtom250g
- E.Regio.Möhren
- EGEN M.Pf.Risp.to.
- Einlegegurken
- ERDBEERE
- ERDBEERE RHEINL
- ErdbeereALDInaLose
- Erdbeeren
- Erdbeeren 500g
- Erdbeeren kg
- Erdbeeren lose
- ERRR Brombeeren
- Feigen frisch
- Frank.Wilde Rauke
- Fresh-Cut-Salat 2
- Frühk.Drillinge1kg
- Frühkart.Vwfk2.5kg
- Frühkartoffeln
- G&G Broccoli
- G&G Champignons
- G&G Knoblauch
- G&G Nektarinen
- G&G Trauben
- HEIDELBEERE
- Heidelbeeren 200g
- Heidelbeeren 300g
- Heidelbeeren 500g
- Herz Nektar. gelb
- Herz.Champign.sch.
- Herz.Frühkartoff.
- Herz.Guacamole
- Herz.Junger Spinat
- Herz.Kult.Heidelb.
- Herz.Mi.Rispe
- Herz.Mi.Rispentom.
- Herz.Paprikaglock.
- Herz.Salat _(has an unlinked historical line)_
- Herz.Salatmix
- Kart. Vwfk 2.5kg
- Kart.Drillinge 1kg
- Kartoffeln
- Kirschen / KIRSCHEN
- Kirschen lose
- Kiwi Gold
- Kiwi Gold Jumbo
- Kiwi gold Stück
- Knoblauch weiß200g
- Kokosnüsse
- Kopfsalat Petersi.
- Kult.Heidelb.
- Kulturheidelbeeren
- Landgurke Bio
- Mangos _(has an unlinked historical line)_
- MELONE PERLA
- Mini BioKarot 200g
- Mini Romarispent.
- Nektarinen
- Nektarinen 1kg
- Nektarinen 500g
- Obst-Sortiment
- Paprika rot / PAPRIKA ROT
- Paprika rot 500g
- Paprika rot lose
- Paprika süß/scharf
- Pau.Champignons
- Pfirsiche
- Pfirsiche 1kg
- Pfirsiche gelb
- Plattnektarine500g
- Plattpfirsich 500g
- Plattpirsich 500g
- PURA Erdbeeren _(has an unlinked historical line)_
- Radieschen
- RadieschenBund Stk
- RiesenCham.we. 400g
- RiesenCham.we.400g
- RiesenCham.wo.400g
- Rispentomaten _(has an unlinked historical line)_
- Rispentomaten lose
- Rucola 125g
- SALAT WILDKR.
- SalatmWurzb
- Schnittkräuter
- Snackgurken
- Sonnentomaten lose
- Spargel _(has an unlinked historical line)_
- Spargel gesch.400g
- Spargel grün 400g
- Spargel w/v 500g
- SUESSKARTOFFEL
- Süßkartoffeln / SÜßkartoffeln
- Tafeltrauben
- Topf Basilikum XL
- TRAUBE HELL KL
- Trauben dunk. 500g
- Trauben hell 500g
- Wasserm.kernlos
- Wassermel kernarm
- Wassermel.kernl
- ZE Kiwis Gold _(has an unlinked historical line)_
- Zitronen Prem. Stk
- Zuckermais 400g va
- Zwetschgen lose
- Zwiebel-Mix Stk
- Zwiebeln Bio 750g

## Одяг

- BANANALU Silky Gloss Elastic 20 Denier Women's Tights Multifibra, nero
- Barts Men's Mr. Mitchell Newspaper Cap 0019-Dark Grey, 56, M
- Barts Mens Mr. Mitchell Funky Style Adjustable Newsboy Flat Cap Hat
- Closemate 6 Pairs Bamboo Socks Men Women 39-42 43-46, Thin Sneaker Socks, Breathable Short Socks for Summer, 6 White, L
- Damen Sportbekleidung
- Handtaschen
- Herren Accessoires
- Herren Premium Designer
- Herren Sportbekleidung
- Kleider
- Nike Revolution
- Nur Die Women's Goodbye Laufmaschen 60 Strumpfhose Tights, 60 DEN, Black (Schwarz 94), 13
- Stepace Round Shoelaces, 2 Pairs, Tear-Resistant Shoelaces for Hiking Shoes, Work Shoes, Trekking Shoes, Approx. 4.5 mm in Diameter, 100 cm–180 cm Length

## Послуги

- Assurant 2 Year Accident and Theft Protection for ONE Laptop from €950 to €999.99
- Assurant 3 Year Warranty Extension for ONE Monitor from €500 to €549.99
- Доставка Amazon

## Розваги

- 16 Pieces Wooden Puzzles for Children - Boys and Girls 1, 2 and 3 Years, Ideal as Birthday and Nursery Gift, Montessori Educational Toy, Original Gifts, Animal Wooden Puzzles (16 Puzzles)
- 46Pcs Kids Knife Set for Real Cooking: Montessori Kitchen Tools for Toddlers, Kitchen Toy for 3 4 5 6 7 8 9 10 Year Old Boys Girls Birthday Gifts
- Captains of Crush Grip Trainer
- FitBeast Flex Therapy Bar, Tennis Elbow Therapy Bar, Ideal for Relieving Tendinitis Pain and Improving Grip Strength, Fitness Resistance Bar for Golfer's Elbow
- Forearm Wrist Roller Trainer, Forearm Trainer for Training with Extremely Strong Nylon Webbing, Forearm Trainer Wrist Roller for Muscle Strength Training at Home, in the Gym or Outdoors
- Grarain Busy Board for Toddlers - Montessori Educational Toy for 1-3 Year Old Boys & Girls | Travel-Friendly Sensory Learning Activity | Ideal for Kids with Autism(Busy Board v3)
- P&K Luftballons
- Quanquer Water Gun for Kids, 280 ml Water Gun with 9 Metre Range, Toy for Garden Parties, Pool Other Outdoor Activities for Boys and Girls (2 Pack)
- RUF Zahlenkerze
- Sahara Sailor Water Bottle, Sports Water Bottle, (BPA-Free Tritan) 1L/500 ml/750 ml, Leak-Proof Sports Water Bottle, Sports Bottle for Bike, Camping, Yoga, Gym (1 Bottle)
- WOODENFUN My Body Puzzle for Children 3-5, Montessori Anatomy Game Set, Layered Puzzle for Preschool Children and Children from 3 Years (Girls)
- YCHLCHL Wooden Pull Up Bar Set Hand Grip Forearm Finger Exerciser Climbing Exercise Equipment for Door Pull Up Bar Fitness Bouldering Kettlebells

## Солодке

- AMARENA KIRSCH
- Bio Knusperriegel
- Buttercroissant
- Buttercroissant 3 für 1€
- Butterwaffeln6x40g
- C&W Erd.Jog.Kuchen _(has an unlinked historical line)_
- C&W Lem.Cheesecake
- Cremiss.Vanill.Eis
- Cremissimo Eis _(has an unlinked historical line)_
- Erlenbach.Schnitte
- Ferrero Himb Chees
- Gade. Amarettini
- Hachez Cocoa
- Kinder Bueno Eis / KINDER BUENO EIS
- Kinder Maxi King
- Kinder Pingui
- Kinder Pingui 4er
- Knoppers 8+1
- Knoppers Erdnuss
- Knoppers Joghurt
- Knoppers Riegel +1
- Knoppers Riegel So
- Knoppers WM 8+1
- Lang.Cremiss.Eis _(has an unlinked historical line)_
- Leibniz Haferkeks
- Lindt Excell.85%
- Lindt Extra Tafel
- Lindt Fioret.Capp.
- Lindt L.Grandes H.
- Lindt Limo.Tafel
- Lindt Lindor Pist.
- Lindt Lindor Stick
- Lindt Lindor Taf.
- Lindt Mini Pralin.
- Magn. UtopiaD.Cherry255ml
- Magnum
- Magnum D.Hazelnut
- Magnum Double Che.
- Magnum Euphoria
- Magnum La Pis
- Magnum La Pistache
- Magnum LaPistacheEis270ml
- Milka 81-100g
- Milka Großtafeln
- Milka Karamell
- Milka Mini Cones
- Milka Pralin.Stick
- Milka V.&Ch.Swirl
- Moser Leckerbissen _(has an unlinked historical line)_
- MR Schokolade
- Nuii Cream White
- Nuii Cream&Pistac.
- Nuii Eiscreme
- Null Stieleis
- Oetk.Göttersp.Ki.
- Oetk.Kaltscha.Him.
- R.Mount.Marshmall.
- Zetti Knusp.Flock.

## Хімія/гігієна

- 8 pieces steam cleaner accessories for Kärcher SC1 SC2 SC3 SC4 SC5, hand steam cleaner, powerful cleaning brush, round brush, large, mouthpiece nozzle, power nozzles, for kitchen furniture, floor,
- Alpecin Sens.Shampoo S1
- Beauty
- Christina Agull.Signat.EdP30ml
- Dontodent Zahnseidesti
- Dr. Beckmann Deo
- DWT SF Volumen Mega stark
- Finish Caps
- Finish MTR 2x250ml
- G&G Allzwecktüch.
- G&G Pow.Fettlöser
- G&G Schwamm
- Geoviizon Cleaning Solution Compatible with Ecovacs Deebot X8/X9/X11/T50/X5 Omni/X2 OMNI/T30S Combo / T30 (Pro) Omni/T20 OMNI/X1 OMNI/X1e OMNI/X1 TURBO/T10 TURBO Robot Vacuum Cleaner
- Glücksblatt HHP 3l
- Hair Rollers Set 50 Pieces, 24 Pieces 4 Sizes (60/48/36/25 mm) with 24 Stainless Steel Clips, Large Self-Adhesive, Hair Rollers, Hair Rollers with Clips for Long, Medium and Short Hair
- MAY Masc.Lash Sens.Intense bl.
- Nivea Deo Roll-on
- Pack of 17 Accessories for Ecovacs Deebot X9 Pro Omni / X11 Pro Omni / T80S Omni Robot Vacuum Cleaner, 4 Vacuum Cleaner Bags, 4 Side Brushes, 4 Filters, 1 Main Brush, 2 Mop Rollers, 1 Cleaning Brush, 1 Screwdriver
- Pantene Pro-V
- Pantene Shampoo Rep.&Care
- Persil 4in1 Discs
- Philips CA6704/10 Coffee Oil Remover, 6 Tablets for Philips, Saeco and Other Fully Automatic Coffee Machines
- Rexona Deo Roll-On NP Bright B
- Rexona Deo Roll-On NP Cott.Dry
- s.Oliver Life Time Wom.EdT30ml
- Somat4in1CapsExc.49ST
- topa 3lg. 10x220
- Zewa Wisch&Weg8x45

## Unlinked historical item names

- Alpro Bar.Drink 1l
- Alpro Soya Drink
- Bio Allos Creamy
- Bio Auberginen
- Bio Edeka Bananen
- Bond.Familiy-Mix
- Brugge Alt
- C&W Erd.Jog.Kuchen
- Coke Zero 1,25l
- Cremissimo Eis
- EIFEL Eier FlH / EIFEL Eier FLH
- G&G MiWa st.6x1,5l
- G&G Mozzarella
- Galb.Mozzarella
- Harry Sandwich
- Herz.Salat
- Hohes C Eisen 1l
- Kerrygold Butter
- Lang.Cremiss.Eis
- Lays Gesalzen
- Leergut Einw.allg.
- Leergut Entl.allg.
- Mangos
- Mayb.Rose AF 0,75l
- Mayb.Weiß AF0,75l
- Meggle Baguette
- Moser Leckerbissen
- Pau.Weißb.Z.0,33l
- Paul.Weiß.af.0,5l
- Petit Camembert
- Pfand
- PURA Erdbeeren
- Rispentomaten
- Spargel
- Vici Meeres Snacks
- Vici Surimi Sticks
- ZE Kiwis Gold
