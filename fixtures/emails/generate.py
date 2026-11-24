"""Generates the synthetic email eval set (spec §5.5). All people, companies and addresses are fictional.
Run: python3 fixtures/emails/generate.py  (rewrites eml/*.eml and cases.json)"""
import json, pathlib, email.utils
from email.message import EmailMessage

ROOT = pathlib.Path(__file__).parent
APPS = [
  {"id": 1, "company": "Lumen Robotics", "title": "Senior Product Manager, AI Platform", "status": "applied", "senderDomains": ["lumen-robotics.example", "greenhouse.io"], "atsRefIds": ["LR-2291"], "companyDomain": "lumen-robotics.example"},
  {"id": 2, "company": "Fjord Mobility", "title": "Product Manager, Autonomy", "status": "applied", "senderDomains": ["hire.lever.co"], "atsRefIds": [], "companyDomain": "fjordmobility.example"},
  {"id": 3, "company": "Northpeak Capital", "title": "Venture Partner, Deep Tech", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "northpeak.example"},
  {"id": 4, "company": "Sable Insurance", "title": "AI Transformation Manager", "status": "applied", "senderDomains": ["myworkday.com"], "atsRefIds": ["R-5512"], "companyDomain": "sable-insurance.example"},
  {"id": 5, "company": "Meridian Works", "title": "Founding Product Manager", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "meridianworks.example"},
  {"id": 6, "company": "Alpenforge AG", "title": "Director of Engineering", "status": "applied", "senderDomains": ["personio.de"], "atsRefIds": [], "companyDomain": "alpenforge.example"},
  {"id": 7, "company": "Quarry Health", "title": "Strategy Manager, Digital", "status": "applied", "senderDomains": ["smartrecruiters.com"], "atsRefIds": [], "companyDomain": "quarryhealth.example"},
  {"id": 8, "company": "Tejo Analytics", "title": "Head of Product", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "tejo-analytics.example"},
  {"id": 9, "company": "Cobalt Energy", "title": "Venture Builder", "status": "applied", "senderDomains": ["recruitee.com"], "atsRefIds": [], "companyDomain": "cobaltenergy.example"},
  {"id": 10, "company": "Vantage Ledger", "title": "Blockchain Product Lead", "status": "interview", "senderDomains": [], "atsRefIds": [], "companyDomain": "vantageledger.example"},
  {"id": 11, "company": "Kestrel Data", "title": "Solutions Architect", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "kestreldata.example"},
  {"id": 12, "company": "Halden Group", "title": "Strategy Consultant", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "halden-group.example"},
  {"id": 13, "company": "Brightline Pay", "title": "Product Lead, Payments Infrastructure", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "brightlinepay.example"},
  {"id": 14, "company": "Brightline Pay", "title": "Product Manager, Risk", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "brightlinepay.example"},
  {"id": 15, "company": "Orbit Freight", "title": "AI Solutions Lead", "status": "applied", "senderDomains": ["workablemail.com"], "atsRefIds": [], "companyDomain": "orbitfreight.example"},
  {"id": 16, "company": "Sierra Azul", "title": "Gerente de Producto", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "sierra-azul.example"},
  {"id": 17, "company": "Ribeira Tech", "title": "Product Owner", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "ribeiratech.example"},
  {"id": 18, "company": "Lago Digitale", "title": "Product Manager", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "lagodigitale.example"},
  {"id": 19, "company": "Maison Verte", "title": "Chef de produit", "status": "applied", "senderDomains": [], "atsRefIds": [], "companyDomain": "maisonverte.example"},
]

# (file, from, subject, body, expected_class, expected_app_id or None, recorded_confidence, html_or_None)
C = []
def add(name, frm, subject, body, cls, app=None, conf=0.94, html=None, company=None, role=None, refs=None):
    C.append(dict(file=f"{name}.eml", frm=frm, subject=subject, body=body, cls=cls, app=app, conf=conf, html=html, company=company, role=role, refs=refs or []))

# ---------- EN ----------
add("en-received-greenhouse", "Lumen Robotics <no-reply@us.greenhouse-mail.io>", "Thank you for applying to Lumen Robotics", "Hi Alex,\n\nThank you for your application for Senior Product Manager, AI Platform (LR-2291). Our team will review it and get back to you.\n\nLumen Robotics Recruiting", "application_received", 1, company="Lumen Robotics", role="Senior Product Manager, AI Platform", refs=["LR-2291"])
add("en-received-lever", "Fjord Mobility <no-reply@hire.lever.co>", "Thanks for applying to Fjord Mobility", "Hi Alex,\n\nThanks for your interest in the Product Manager, Autonomy role. We have received your application and will be in touch if there is a fit.\n\nThe Fjord Mobility team", "application_received", 2, company="Fjord Mobility", role="Product Manager, Autonomy")
add("en-received-workday", "Sable Insurance <sable@myworkday.com>", "Application received: AI Transformation Manager (R-5512)", "Dear Alex,\n\nWe confirm receipt of your application for AI Transformation Manager, requisition R-5512. You can track the status in our candidate portal.\n\nSable Insurance Talent Acquisition", "application_received", 4, company="Sable Insurance", role="AI Transformation Manager", refs=["R-5512"])
add("en-rejection-plain", "Northpeak Capital <talent@northpeak.example>", "Your application to Northpeak Capital", "Dear Alex,\n\nThank you for your interest in the Venture Partner, Deep Tech position. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our needs.\n\nWe wish you all the best.\nNorthpeak Capital", "rejection", 3, company="Northpeak Capital", role="Venture Partner, Deep Tech")
add("en-rejection-after-interview", "Vantage Ledger <people@vantageledger.example>", "Update on your interview with Vantage Ledger", "Hi Alex,\n\nThank you for taking the time to interview with us last week for the Blockchain Product Lead role. After careful consideration, we have decided not to proceed with your application at this time.\n\nKind regards,\nVantage Ledger People Team", "rejection", 10, company="Vantage Ledger", role="Blockchain Product Lead")
add("en-rejection-ats", "Kestrel Data <no-reply@greenhouse-mail.io>", "Kestrel Data: Solutions Architect", "Hi Alex,\n\nWe appreciate your interest in Kestrel Data. We regret to inform you that we will not be moving forward with your application for Solutions Architect.\n\nBest,\nKestrel Data Recruiting", "rejection", 11, company="Kestrel Data", role="Solutions Architect")
add("en-interview", "Sam Rivera <sam.rivera@meridianworks.example>", "Interview invitation – Founding Product Manager", "Hi Alex,\n\nThanks for applying for the Founding Product Manager role. We'd love to invite you to a 45-minute video interview with our CEO. Could you share a few time slots for next week?\n\nBest,\nSam", "interview_invite", 5, company="Meridian Works", role="Founding Product Manager")
add("en-interview-ambiguous", "Jo Park <jo.park@brightlinepay.example>", "Next steps with Brightline Pay", "Hi Alex,\n\nThanks for your application to Brightline Pay. We'd like to schedule a first interview with our product team. Please use the link below to book a slot.\n\nJo", "interview_invite", 13, conf=0.9, company="Brightline Pay", role=None)
add("en-assessment", "Orbit Freight <careers@workablemail.com>", "Orbit Freight – next step: case study", "Hi Alex,\n\nThank you for your application for AI Solutions Lead. As a next step we would like you to complete a short case study. You will have 5 days to submit it via the link below.\n\nOrbit Freight", "assessment", 15, company="Orbit Freight", role="AI Solutions Lead")
add("en-offer", "Sam Rivera <sam.rivera@meridianworks.example>", "Your offer from Meridian Works", "Hi Alex,\n\nWe are delighted to offer you the position of Founding Product Manager at Meridian Works. Please find the offer letter attached. We'd be happy to walk you through it.\n\nSam", "offer", 5, company="Meridian Works", role="Founding Product Manager")
add("en-recruiter", "Dana Holt <dana@talentbridge.example>", "Exciting Head of Product opportunity", "Hi Alex,\n\nI'm a recruiter at TalentBridge. I came across your profile and think you'd be a great fit for a Head of Product role at a fast-growing fintech in Zurich. Open to a quick chat?\n\nDana", "recruiter_outreach", None, company=None, role="Head of Product")
add("en-linkedin-alert", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "“product manager”: 2 new jobs in Zurich", "Your job alert for product manager in Zurich\n\nSenior Product Manager\nAurora Labs · Zurich (Hybrid)\n\nProduct Lead\nGlacier Bank · Zurich", "job_alert", None,
    html='<html><body><table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4100000001/?trk=alert">Senior Product Manager</a><div>Aurora Labs · Zurich (Hybrid)</div></td></tr><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4100000002/">Product Lead</a><div>Glacier Bank · Zurich</div></td></tr></table><a href="https://www.linkedin.com/comm/jobs/search">See all jobs</a></body></html>')
add("en-newsletter-ats", "Greenhouse <newsletter@greenhouse.io>", "5 interview tips from hiring managers", "Our latest blog post: five interview tips from hiring managers, plus new product updates for recruiters.\n\nUnsubscribe from these emails", "other", None, conf=0.9)
add("en-personal", "Chris <chris@friends.example>", "Dinner on Friday?", "Hey, are you free for dinner on Friday? Let me know!", "other", None)

# ---------- DE ----------
add("de-received", "Alpenforge AG <jobs@personio.de>", "Ihre Bewerbung als Director of Engineering", "Guten Tag\n\nVielen Dank für Ihre Bewerbung als Director of Engineering bei der Alpenforge AG. Wir haben Ihre Unterlagen erhalten und melden uns in Kürze.\n\nFreundliche Grüsse\nAlpenforge AG", "application_received", 6, company="Alpenforge AG", role="Director of Engineering")
add("de-received-2", "Cobalt Energy <bewerbung@recruitee.com>", "Eingangsbestätigung: Venture Builder", "Hallo Alex\n\ndanke für deine Bewerbung als Venture Builder. Wir prüfen deine Unterlagen und melden uns innerhalb von zwei Wochen.\n\nDein Cobalt Energy Team", "application_received", 9, company="Cobalt Energy", role="Venture Builder")
add("de-rejection", "Quarry Health <noreply@smartrecruiters.com>", "Ihre Bewerbung bei Quarry Health", "Sehr geehrter Herr Example\n\nvielen Dank für Ihr Interesse. Leider müssen wir Ihnen mitteilen, dass wir uns für andere Kandidatinnen und Kandidaten entschieden haben.\n\nMit freundlichen Grüssen\nQuarry Health", "rejection", 7, company="Quarry Health", role="Strategy Manager, Digital")
add("de-rejection-2", "Alpenforge AG <jobs@personio.de>", "Absage: Director of Engineering", "Guten Tag\n\nwir bedanken uns für Ihre Bewerbung. Nach sorgfältiger Prüfung können wir Ihre Bewerbung leider nicht berücksichtigen.\n\nFreundliche Grüsse\nAlpenforge AG", "rejection", 6, company="Alpenforge AG", role="Director of Engineering")
add("de-rejection-3", "Lumen Robotics <recruiting@lumen-robotics.example>", "Rückmeldung zu deiner Bewerbung", "Hallo Alex\n\nherzlichen Dank für deine Zeit im Kennenlerngespräch. Leider haben wir uns entschieden, den Prozess mit einer anderen Person fortzusetzen.\n\nLiebe Grüsse\nLumen Robotics", "rejection", 1, company="Lumen Robotics")
add("de-interview", "Cobalt Energy <hr@cobaltenergy.example>", "Einladung zum Vorstellungsgespräch", "Hallo Alex\n\nwir freuen uns, dich zu einem Vorstellungsgespräch für die Position Venture Builder einzuladen. Passt dir Dienstag um 14 Uhr in Zug?\n\nViele Grüsse\nCobalt Energy", "interview_invite", 9, company="Cobalt Energy", role="Venture Builder")
add("de-interview-2", "Alpenforge AG <hr@alpenforge.example>", "Kennenlerngespräch Director of Engineering", "Guten Tag\n\ngerne möchten wir Sie zu einem ersten Kennenlerngespräch per Video einladen. Bitte wählen Sie einen Termin über den folgenden Link.\n\nFreundliche Grüsse", "interview_invite", 6, company="Alpenforge AG", role="Director of Engineering")
add("de-assessment", "Quarry Health <noreply@smartrecruiters.com>", "Nächster Schritt: Online-Eignungstest", "Guten Tag\n\nim nächsten Schritt bitten wir Sie, unseren Online-Eignungstest für die Stelle Strategy Manager, Digital zu absolvieren. Der Test dauert etwa 30 Minuten.\n\nQuarry Health", "assessment", 7, company="Quarry Health", role="Strategy Manager, Digital")
add("de-offer", "Cobalt Energy <hr@cobaltenergy.example>", "Vertragsangebot Venture Builder", "Hallo Alex\n\nwir freuen uns sehr, dir die Stelle als Venture Builder anzubieten. Im Anhang findest du unser Vertragsangebot.\n\nHerzliche Grüsse\nCobalt Energy", "offer", 9, company="Cobalt Energy", role="Venture Builder")
add("de-recruiter", "Mia Keller <mia.keller@headhunt.example>", "Spannende Position als CPO", "Guten Tag Herr Example\n\nich bin Personalberaterin und betreue aktuell eine Position als Chief Product Officer bei einem Scale-up in Basel. Hätten Sie Interesse an einem kurzen Austausch?\n\nBeste Grüsse\nMia Keller", "recruiter_outreach", None, role="Chief Product Officer")
add("de-newsletter", "Stellenmarkt Weekly <news@stellenmarkt.example>", "Die besten Tipps für Ihr Vorstellungsgespräch", "Diese Woche: So bereiten Sie sich auf ein Vorstellungsgespräch vor.\n\nNewsletter abmelden", "other", None)

# ---------- FR ----------
add("fr-received", "Maison Verte <recrutement@maisonverte.example>", "Votre candidature – Chef de produit", "Bonjour Alex,\n\nNous accusons bonne réception de votre candidature au poste de Chef de produit. Nous reviendrons vers vous rapidement.\n\nL'équipe Maison Verte", "application_received", 19, company="Maison Verte", role="Chef de produit")
add("fr-rejection", "Maison Verte <recrutement@maisonverte.example>", "Suite à votre candidature", "Bonjour Alex,\n\nNous vous remercions de l'intérêt porté à Maison Verte. Malheureusement, nous ne pouvons pas donner une suite favorable à votre candidature.\n\nCordialement", "rejection", 19, company="Maison Verte", role="Chef de produit")
add("fr-rejection-2", "Lumen Robotics <recruiting@lumen-robotics.example>", "Votre candidature chez Lumen Robotics", "Bonjour Alex,\n\nAprès étude attentive de votre profil, nous avons le regret de vous informer que nous avons retenu une autre candidature.\n\nBien cordialement,\nLumen Robotics", "rejection", 1, company="Lumen Robotics")
add("fr-interview", "Maison Verte <recrutement@maisonverte.example>", "Invitation à un entretien", "Bonjour Alex,\n\nVotre profil a retenu notre attention. Nous souhaiterions vous rencontrer pour un entretien la semaine prochaine. Quelles sont vos disponibilités ?\n\nCordialement", "interview_invite", 19, company="Maison Verte", role="Chef de produit")
add("fr-interview-2", "Fjord Mobility <no-reply@hire.lever.co>", "Fjord Mobility – entretien", "Bonjour Alex,\n\nMerci pour votre candidature au poste Product Manager, Autonomy. Nous aimerions organiser un entretien téléphonique de 30 minutes.\n\nFjord Mobility", "interview_invite", 2, company="Fjord Mobility", role="Product Manager, Autonomy")
add("fr-assessment", "Maison Verte <recrutement@maisonverte.example>", "Test technique", "Bonjour Alex,\n\nDans le cadre de votre candidature, nous vous invitons à réaliser un test technique en ligne avant vendredi.\n\nCordialement", "assessment", 19, company="Maison Verte")
add("fr-offer", "Maison Verte <direction@maisonverte.example>", "Proposition d'embauche", "Bonjour Alex,\n\nNous avons le plaisir de vous proposer le poste de Chef de produit. Vous trouverez ci-joint notre proposition d'embauche.\n\nBien à vous", "offer", 19, company="Maison Verte", role="Chef de produit")
add("fr-other", "Banque Exemple <info@banque.example>", "Votre relevé mensuel", "Bonjour, votre relevé de compte est disponible dans votre espace client.", "other", None)

# ---------- ES ----------
add("es-received", "Sierra Azul <talento@sierra-azul.example>", "Hemos recibido tu candidatura", "Hola Alex:\n\nGracias por postularte a la vacante de Gerente de Producto. Hemos recibido tu solicitud y la revisaremos pronto.\n\nEquipo de Talento, Sierra Azul", "application_received", 16, company="Sierra Azul", role="Gerente de Producto")
add("es-received-2", "Tejo Analytics <jobs@tejo-analytics.example>", "Candidatura recibida: Head of Product", "Hola Alex,\n\nconfirmamos la recepción de tu candidatura para Head of Product. Te contactaremos si tu perfil encaja.\n\nTejo Analytics", "application_received", 8, company="Tejo Analytics", role="Head of Product")
add("es-rejection", "Sierra Azul <talento@sierra-azul.example>", "Actualización sobre tu candidatura", "Hola Alex:\n\nAgradecemos tu interés. Lamentablemente, en esta ocasión hemos decidido continuar con otros candidatos.\n\nSaludos cordiales", "rejection", 16, company="Sierra Azul", role="Gerente de Producto")
add("es-rejection-2", "Tejo Analytics <jobs@tejo-analytics.example>", "Tu proceso con Tejo Analytics", "Hola Alex,\n\nDesafortunadamente no podremos avanzar con tu candidatura para Head of Product.\n\nUn saludo", "rejection", 8, company="Tejo Analytics", role="Head of Product")
add("es-interview", "Sierra Azul <talento@sierra-azul.example>", "Invitación a entrevista", "Hola Alex:\n\nNos gustaría invitarte a una entrevista para la posición de Gerente de Producto. ¿Te viene bien el jueves a las 10:00 (hora de Ciudad de México)?\n\nSaludos", "interview_invite", 16, company="Sierra Azul", role="Gerente de Producto")
add("es-assessment", "Sierra Azul <talento@sierra-azul.example>", "Prueba técnica – Gerente de Producto", "Hola Alex:\n\nComo siguiente paso, te pedimos completar una prueba técnica en línea en los próximos 3 días.\n\nSaludos", "assessment", 16, company="Sierra Azul", role="Gerente de Producto")
add("es-offer", "Sierra Azul <direccion@sierra-azul.example>", "Oferta laboral", "Hola Alex:\n\nNos complace ofrecerte el puesto de Gerente de Producto. Adjuntamos la oferta laboral con todos los detalles.\n\nSaludos", "offer", 16, company="Sierra Azul", role="Gerente de Producto")
add("es-alert", "OCC Mundial <alertas@occ.com.mx>", "Nuevas vacantes para Gerente de Producto", "Nuevas vacantes que coinciden con tu búsqueda:\n\nGerente de Producto Digital - Banco Ejemplo - CDMX\nProduct Owner - Retail Ejemplo - Guadalajara", "job_alert", None)

# ---------- PT ----------
add("pt-received", "Ribeira Tech <pessoas@ribeiratech.example>", "Recebemos a tua candidatura", "Olá Alex,\n\nObrigado pela tua candidatura para Product Owner. Vamos analisá-la e entraremos em contacto em breve.\n\nEquipa Ribeira Tech", "application_received", 17, company="Ribeira Tech", role="Product Owner")
add("pt-rejection", "Ribeira Tech <pessoas@ribeiratech.example>", "A tua candidatura na Ribeira Tech", "Olá Alex,\n\nAgradecemos o teu interesse. Infelizmente, decidimos avançar com outros candidatos para esta posição.\n\nCumprimentos", "rejection", 17, company="Ribeira Tech", role="Product Owner")
add("pt-rejection-2", "Tejo Analytics <jobs@tejo-analytics.example>", "Atualização da tua candidatura", "Olá Alex,\n\nInfelizmente não vamos prosseguir com a tua candidatura para Head of Product.\n\nObrigado", "rejection", 8, company="Tejo Analytics", role="Head of Product")
add("pt-interview", "Ribeira Tech <pessoas@ribeiratech.example>", "Convite para entrevista", "Olá Alex,\n\nGostaríamos de te convidar para uma entrevista para a posição de Product Owner. Tens disponibilidade na próxima semana?\n\nCumprimentos", "interview_invite", 17, company="Ribeira Tech", role="Product Owner")
add("pt-interview-2", "Sable Insurance <sable@myworkday.com>", "Entrevista: AI Transformation Manager (R-5512)", "Olá Alex,\n\nGostaríamos de agendar uma entrevista para a vaga R-5512 em Lisboa.\n\nSable Insurance", "interview_invite", 4, company="Sable Insurance", role="AI Transformation Manager", refs=["R-5512"])
add("pt-assessment", "Ribeira Tech <pessoas@ribeiratech.example>", "Próximo passo: avaliação", "Olá Alex,\n\nO próximo passo é uma avaliação online de 45 minutos. Encontra o link abaixo.\n\nCumprimentos", "assessment", 17, company="Ribeira Tech")
add("pt-offer", "Ribeira Tech <direcao@ribeiratech.example>", "Proposta de emprego", "Olá Alex,\n\nTemos o prazer de te fazer uma proposta de emprego para Product Owner. Segue em anexo a proposta.\n\nAbraço", "offer", 17, company="Ribeira Tech", role="Product Owner")
add("pt-recruiter", "Rita Sousa <rita@recrutapro.example>", "Oportunidade de Head of Product em Lisboa", "Olá Alex,\n\nSou recrutadora e tenho uma oportunidade de Head of Product numa scale-up em Lisboa. Podemos falar?\n\nRita", "recruiter_outreach", None, role="Head of Product")

# ---------- IT ----------
add("it-received", "Lago Digitale <hr@lagodigitale.example>", "Abbiamo ricevuto la tua candidatura", "Ciao Alex,\n\ngrazie per la tua candidatura come Product Manager. La esamineremo e ti faremo sapere.\n\nLago Digitale", "application_received", 18, company="Lago Digitale", role="Product Manager")
add("it-rejection", "Lago Digitale <hr@lagodigitale.example>", "Aggiornamento sulla tua candidatura", "Ciao Alex,\n\nti ringraziamo per l'interesse. Purtroppo abbiamo deciso di proseguire con altri candidati.\n\nCordiali saluti", "rejection", 18, company="Lago Digitale", role="Product Manager")
add("it-rejection-2", "Halden Group <careers@halden-group.example>", "La sua candidatura presso Halden Group", "Gentile Alex,\n\npurtroppo non possiamo dare seguito alla sua candidatura per la posizione di Strategy Consultant.\n\nCordiali saluti", "rejection", 12, company="Halden Group", role="Strategy Consultant")
add("it-interview", "Lago Digitale <hr@lagodigitale.example>", "Invito a colloquio", "Ciao Alex,\n\nvorremmo invitarti a un colloquio conoscitivo per la posizione di Product Manager. Sei disponibile giovedì?\n\nA presto", "interview_invite", 18, company="Lago Digitale", role="Product Manager")
add("it-assessment", "Lago Digitale <hr@lagodigitale.example>", "Prossimo passo: valutazione online", "Ciao Alex,\n\nil prossimo passo è una valutazione online. Trovi il link qui sotto.\n\nLago Digitale", "assessment", 18, company="Lago Digitale")
add("it-other", "Palestra Esempio <info@palestra.example>", "Il tuo abbonamento", "Ciao, il tuo abbonamento in palestra scade a fine mese.", "other", None)

for i, c in enumerate(C):
    m = EmailMessage()
    m["From"] = c["frm"]
    m["To"] = "Alex Example <alex@example.com>"
    m["Subject"] = c["subject"]
    m["Date"] = email.utils.format_datetime(email.utils.localtime().replace(year=2026, month=11, day=1 + i % 20, hour=9, minute=i % 60, second=0, microsecond=0))
    m["Message-ID"] = f"<case-{i}@fixtures.jobhunter.example>"
    m.set_content(c["body"])
    if c["html"]:
        m.add_alternative(c["html"], subtype="html")
    (ROOT / "eml" / c["file"]).write_text(m.as_string(), encoding="utf-8")

cases = [{"file": c["file"], "expected": {"classification": c["cls"], "applicationId": c["app"]},
          "recorded": {"classification": c["cls"], "company": c["company"], "role": c["role"], "confidence": c["conf"],
                       "keySentence": None, "referenceIds": c["refs"]}} for c in C]
(ROOT / "cases.json").write_text(json.dumps({"applications": APPS, "cases": cases}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(len(C), "emails")
