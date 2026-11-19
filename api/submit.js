const nodemailer = require("nodemailer");

function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pick(obj, keys, fallback = "") {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return fallback;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const data = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const team = data.team || data.candidate || data.student || data.participant || data;
    const summary = data.summary || data.stats || data.result || data.scores || data;

    const teamName = pick(team, ["teamName", "name", "team", "studentName", "candidate1"], "Unknown Team");
    const teamCode = pick(team, ["teamCode", "teamId", "chestNo", "code", "id", "regNo"], "-");
    const member1 = pick(team, ["candidate1", "member1", "student1", "participant1"], "");
    const member2 = pick(team, ["candidate2", "member2", "student2", "participant2"], "");
    const institution = pick(team, ["institution", "college", "school", "unit", "pool"], "-");
    const submitReason = pick(data, ["reason", "submitReason", "submissionReason", "trigger", "status"], "Submitted");
    const timeTaken = pick(data, ["timeTaken", "duration", "elapsedTime", "timeUsed"], "-");
    const submittedAt = pick(data, ["submittedAt", "timestamp"], new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));

    const answers = Array.isArray(data.answers)
      ? data.answers
      : Array.isArray(data.responses)
      ? data.responses
      : Array.isArray(data.details)
      ? data.details
      : Array.isArray(data.questions)
      ? data.questions
      : [];

    let correct = pick(summary, ["correct", "correctCount", "right", "mcqCorrect", "score"], null);
    let wrong = pick(summary, ["wrong", "wrongCount", "incorrect", "mcqWrong"], null);
    let unanswered = pick(summary, ["unanswered", "skipped", "unattempted", "blank", "mcqUnanswered"], null);
    let writtenAnswered = pick(summary, ["writtenAnswered", "writtenAttempted", "descriptiveAnswered"], null);

    // summary-യിൽ കണക്കുകൾ നേരിട്ടില്ലെങ്കിൽ answers ലിസ്റ്റിൽ നിന്ന് കൃത്യമായി കണക്കാക്കുന്നു
    if (answers.length > 0 && (correct === null || wrong === null)) {
      let c = 0, w = 0, u = 0, wr = 0;
      for (const a of answers) {
        const type = String(a.type || a.questionType || "").toLowerCase();
        const isWritten = type.includes("written") || type.includes("short") || type.includes("desc");
        const ans = a.userAnswer ?? a.selected ?? a.answer ?? a.response ?? "";
        if (isWritten) {
          if (String(ans).trim()) wr++;
        } else {
          if (ans === "" || ans === null || ans === undefined || ans === -1) u++;
          else if (a.isCorrect === true || a.status === "correct" || ans === a.correctAnswer) c++;
          else w++;
        }
      }
      if (correct === null) correct = c;
      if (wrong === null) wrong = w;
      if (unanswered === null) unanswered = u;
      if (writtenAnswered === null) writtenAnswered = wr;
    }

    correct = Number(correct || 0);
    wrong = Number(wrong || 0);
    unanswered = Number(unanswered || 0);
    writtenAnswered = Number(writtenAnswered || 0);
    const totalMcq = Number(pick(summary, ["totalMcq", "mcqTotal"], correct + wrong + unanswered || 120));
    const accuracy = pick(
      summary,
      ["accuracy", "percentage"],
      totalMcq > 0 ? `${((correct / totalMcq) * 100).toFixed(1)}%` : "0%"
    );

    // Subject-wise table (Science / Math / GK)
    const subjects = data.subjectBreakdown || data.subjects || summary.subjectBreakdown || null;
    let subjectRows = "";
    if (subjects && typeof subjects === "object") {
      const entries = Array.isArray(subjects)
        ? subjects.map((s) => [s.subject || s.name, s])
        : Object.entries(subjects);
      subjectRows = entries
        .map(([name, s]) => `
          <tr>
            <td style="padding:8px;border:1px solid #ddd;"><b>${escapeHtml(name)}</b></td>
            <td style="padding:8px;border:1px solid #ddd;color:#15803d;font-weight:bold;">${escapeHtml(s.correct ?? s.right ?? 0)}</td>
            <td style="padding:8px;border:1px solid #ddd;color:#b91c1c;font-weight:bold;">${escapeHtml(s.wrong ?? s.incorrect ?? 0)}</td>
            <td style="padding:8px;border:1px solid #ddd;color:#6b7280;">${escapeHtml(s.unanswered ?? s.skipped ?? 0)}</td>
          </tr>
        `)
        .join("");
    }

    // Written answers table
    const writtenList = Array.isArray(data.writtenAnswers)
      ? data.writtenAnswers
      : answers.filter((a) => String(a.type || a.questionType || "").toLowerCase().match(/written|short|desc/));

    const writtenRows = writtenList
      .map((item, idx) => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">Q${escapeHtml(item.id || item.qNo || idx + 1)}</td>
          <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(item.question || item.en || item.text || "")}</td>
          <td style="padding:8px;border:1px solid #ddd;background:#f8fafc;">${escapeHtml(item.userAnswer || item.answer || item.response || "— (ഉത്തരം എഴുതിയിട്ടില്ല)")}</td>
          <td style="padding:8px;border:1px solid #ddd;color:#15803d;">${escapeHtml(item.modelAnswer || item.correctAnswer || "-")}</td>
        </tr>
      `)
      .join("");

    // Wrong MCQ review table
    const wrongList = answers.filter(
      (a) =>
        !String(a.type || a.questionType || "").toLowerCase().match(/written|short|desc/) &&
        (a.isCorrect === false || a.status === "wrong" || a.status === "incorrect")
    );

    const wrongRows = wrongList
      .map((item, idx) => `
        <tr>
          <td style="padding:6px;border:1px solid #ddd;">Q${escapeHtml(item.id || item.qNo || idx + 1)}</td>
          <td style="padding:6px;border:1px solid #ddd;">${escapeHtml(item.question || item.en || "")}</td>
          <td style="padding:6px;border:1px solid #ddd;color:#b91c1c;">${escapeHtml(item.userAnswerText || item.userAnswer || item.selected || "-")}</td>
          <td style="padding:6px;border:1px solid #ddd;color:#15803d;">${escapeHtml(item.correctAnswerText || item.correctAnswer || "-")}</td>
        </tr>
      `)
      .join("");

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:780px;margin:auto;color:#111827;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <div style="background:#1e3a8a;color:#ffffff;padding:20px;">
          <h2 style="margin:0;">ARTS FEST '26 — TWS15 TALENT HUNT</h2>
          <p style="margin:6px 0 0;opacity:0.9;">New Exam Submission Report | പുതിയ പരീക്ഷാ റിസൾട്ട്</p>
        </div>

        <div style="padding:20px;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:14px;">
            <tr><td style="padding:6px 0;width:180px;"><b>Team / Name:</b></td><td>${escapeHtml(teamName)} (${escapeHtml(teamCode)})</td></tr>
            ${member1 || member2 ? `<tr><td style="padding:6px 0;"><b>Candidates:</b></td><td>${escapeHtml([member1, member2].filter(Boolean).join(" & "))}</td></tr>` : ""}
            <tr><td style="padding:6px 0;"><b>Institution / Unit:</b></td><td>${escapeHtml(institution)}</td></tr>
            <tr><td style="padding:6px 0;"><b>Submission Type:</b></td><td><b style="color:${String(submitReason).toLowerCase().includes("tab") || String(submitReason).toLowerCase().includes("cheat") ? "#dc2626" : "#1d4ed8"};">${escapeHtml(submitReason)}</b></td></tr>
            <tr><td style="padding:6px 0;"><b>Time Taken / Submitted:</b></td><td>${escapeHtml(timeTaken)} | ${escapeHtml(submittedAt)}</td></tr>
          </table>

          <table style="width:100%;border-collapse:collapse;text-align:center;margin-bottom:20px;">
            <tr>
              <td style="padding:14px;background:#dcfce7;border:1px solid #86efac;">
                <div style="font-size:24px;font-weight:bold;color:#15803d;">${correct} / ${totalMcq}</div>
                <div style="font-size:12px;">ശരിയായവ (Correct)</div>
              </td>
              <td style="padding:14px;background:#fee2e2;border:1px solid #fca5a5;">
                <div style="font-size:24px;font-weight:bold;color:#b91c1c;">${wrong}</div>
                <div style="font-size:12px;">തെറ്റിയവ (Wrong)</div>
              </td>
              <td style="padding:14px;background:#f3f4f6;border:1px solid #d1d5db;">
                <div style="font-size:24px;font-weight:bold;color:#374151;">${unanswered}</div>
                <div style="font-size:12px;">എഴുതാത്തവ (Skipped)</div>
              </td>
              <td style="padding:14px;background:#e0e7ff;border:1px solid #a5b4fc;">
                <div style="font-size:24px;font-weight:bold;color:#3730a3;">${escapeHtml(accuracy)}</div>
                <div style="font-size:12px;">കൃത്യത (Accuracy)</div>
              </td>
            </tr>
          </table>

          ${subjectRows ? `
            <h3 style="margin:18px 0 8px;">Subject-wise Score / വിഷയാടിസ്ഥാനത്തിലുള്ള മാർക്ക്</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
              <tr style="background:#f9fafb;">
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Subject</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Correct</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Wrong</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Skipped</th>
              </tr>
              ${subjectRows}
            </table>
          ` : ""}

          ${writtenRows ? `
            <h3 style="margin:18px 0 8px;">Written Answers (${writtenAnswered} Attempted) / എഴുതിയ ഉത്തരങ്ങൾ</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
              <tr style="background:#f9fafb;">
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">No.</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Question</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Student Answer</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Model Answer</th>
              </tr>
              ${writtenRows}
            </table>
          ` : ""}

          ${wrongRows ? `
            <h3 style="margin:18px 0 8px;">Wrong MCQ Breakdown (${wrongList.length}) / തെറ്റിയ ചോദ്യങ്ങളുടെ വിവരങ്ങൾ</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px;">
              <tr style="background:#fef2f2;">
                <th style="padding:6px;border:1px solid #ddd;text-align:left;">No.</th>
                <th style="padding:6px;border:1px solid #ddd;text-align:left;">Question</th>
                <th style="padding:6px;border:1px solid #ddd;text-align:left;">Selected</th>
                <th style="padding:6px;border:1px solid #ddd;text-align:left;">Correct Answer</th>
              </tr>
              ${wrongRows}
            </table>
          ` : ""}
        </div>
      </div>
    `;

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const coordinatorEmail = process.env.COORDINATOR_EMAIL || data.coordinatorEmail || gmailUser;

    if (!gmailUser || !gmailPass) {
      return res.status(500).json({
        ok: false,
        error: "Vercel Environment Variables (GMAIL_USER, GMAIL_APP_PASSWORD) സെറ്റ് ചെയ്തിട്ടില്ല."
      });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass }
    });

    await transporter.sendMail({
      from: `"TWS15 Talent Hunt" <${gmailUser}>`,
      to: coordinatorEmail,
      subject: `TWS15 Result: ${teamName} (${teamCode}) — Correct: ${correct} | Wrong: ${wrong}`,
      html: htmlBody
    });

    return res.status(200).json({ ok: true, success: true, message: "Result emailed to coordinator" });
  } catch (err) {
    console.error("Mail error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
