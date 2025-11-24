const { jsPDF } = window.jspdf;

let evaluationData = [];
let pageUrl = "";

const defaultSettings = {
  1: true,
  2: true,
  3: true,
  4: true,
  5: true,
  6: true,
  7: true,
  8: true,
  9: true,
  10: true,
};

document.addEventListener("DOMContentLoaded", () => {
  loadSettingsUI();
  renderHistory();
  setupNavigation();

  const savedTheme = localStorage.getItem("heuristicTheme") || "dark";
  setTheme(savedTheme);

  document.getElementById("themeBtn").addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(current === "dark" ? "light" : "dark");
  });

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const portfolioBtn = document.getElementById("portfolioLink");
  if (portfolioBtn) {
    portfolioBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://anurajdesigns.framer.ai/" });
    });
  }

  const clearBtn = document.getElementById("clearHistory");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (confirm("Clear all audit history?")) {
        localStorage.removeItem("heuristicHistory");
        renderHistory();
      }
    });
  }

  document.querySelectorAll(".emoji-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const rating = parseInt(e.target.dataset.rating);
      if (rating >= 4)
        chrome.tabs.create({
          url: "https://chrome.google.com/webstore/category/extensions",
        });
      else
        chrome.tabs.update({
          url: `mailto:anurajdwivedi@gmail.com?subject=HeuristiCheck Feedback`,
        });
    });
  });
});

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("heuristicTheme", theme);
  const icon = document.getElementById("themeIcon");
  if (theme === "light") {
    icon.innerHTML =
      '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
  } else {
    icon.innerHTML =
      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "updateTheme",
        theme: theme,
      });
    }
  });
}

function setupNavigation() {
  const views = ["mainView", "settingsView", "historyView"];
  const hideAll = () =>
    views.forEach((id) => document.getElementById(id).classList.add("hidden"));

  const showView = (viewId) => {
    hideAll();
    document.getElementById(viewId).classList.remove("hidden");
    const header = document.getElementById("mainHeader");
    const desc = document.getElementById("mainDesc");
    if (viewId === "mainView") {
      header.classList.remove("hidden");
      desc.classList.remove("hidden");
    } else {
      header.classList.add("hidden");
      desc.classList.add("hidden");
    }
  };

  document.getElementById("settingsBtn").onclick = () =>
    showView("settingsView");
  document.getElementById("historyBtn").onclick = () => {
    renderHistory();
    showView("historyView");
  };
  document.getElementById("backToHome").onclick = () => showView("mainView");
  document.getElementById("closeSettings").onclick = () => showView("mainView");
  document.getElementById("backFromHistory").onclick = () =>
    showView("mainView");
  document.getElementById("saveSettings").onclick = () => {
    saveSettings();
    showView("mainView");
    showToast("Saved!");
  };
  document.getElementById("closeExtension").onclick = () => window.close();
}

document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url.startsWith("chrome://"))
    return alert("Cannot run on browser pages.");

  const settings =
    JSON.parse(localStorage.getItem("heuristicSettings")) || defaultSettings;
  const provider = localStorage.getItem("heuristicAiProvider") || "openai";
  const theme = localStorage.getItem("heuristicTheme") || "dark";
  const aiModel = localStorage.getItem("heuristicAiModel") || "gpt-3.5-turbo";
  let apiKey =
    provider === "openai"
      ? localStorage.getItem("heuristicOpenAiKey")
      : localStorage.getItem("heuristicGeminiKey");

  const payload = {
    action: "analyze",
    settings,
    apiKey,
    aiProvider: provider,
    theme,
    aiModel,
  };

  chrome.scripting.executeScript(
    { target: { tabId: tab.id }, files: ["content.js"] },
    () => {
      if (chrome.runtime.lastError) return alert("Error injecting script");
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, payload, (response) => {
          if (response && response.results) {
            processResults(response);
            saveToHistory(response.results, response.url);
          }
        });
      }, 100);
    }
  );
});

function saveSettings() {
  const newSettings = {};
  for (let i = 1; i <= 10; i++) {
    const toggle = document.getElementById(`rule-${i}`);
    if (toggle) newSettings[i] = toggle.checked;
  }
  localStorage.setItem("heuristicSettings", JSON.stringify(newSettings));
  const provider = document.getElementById("aiProvider").value;
  const model = document.getElementById("aiModel").value;
  const inputKey = document.getElementById("apiKeyInput").value.trim();
  localStorage.setItem("heuristicAiProvider", provider);
  localStorage.setItem("heuristicAiModel", model);
  if (provider === "openai")
    localStorage.setItem("heuristicOpenAiKey", inputKey);
  else localStorage.setItem("heuristicGeminiKey", inputKey);
}

function loadSettingsUI() {
  const saved =
    JSON.parse(localStorage.getItem("heuristicSettings")) || defaultSettings;
  const provider = localStorage.getItem("heuristicAiProvider") || "openai";
  const model = localStorage.getItem("heuristicAiModel") || "gpt-3.5-turbo";
  const openAiKey = localStorage.getItem("heuristicOpenAiKey") || "";
  const geminiKey = localStorage.getItem("heuristicGeminiKey") || "";

  const providerSelect = document.getElementById("aiProvider");
  const modelSelect = document.getElementById("aiModel");
  const apiKeyInput = document.getElementById("apiKeyInput");

  if (modelSelect) modelSelect.value = model;
  if (providerSelect) {
    providerSelect.value = provider;
    providerSelect.addEventListener("change", (e) => {
      apiKeyInput.value =
        e.target.value === "openai"
          ? localStorage.getItem("heuristicOpenAiKey") || ""
          : localStorage.getItem("heuristicGeminiKey") || "";
    });
  }
  apiKeyInput.value = provider === "openai" ? openAiKey : geminiKey;

  const container = document.getElementById("togglesList");
  if (container) {
    container.innerHTML = "";
    const ruleNames = [
      "Visibility of System Status",
      "Match System & Real World",
      "User Control & Freedom",
      "Consistency & Standards",
      "Error Prevention",
      "Recognition vs Recall",
      "Flexibility of Use",
      "Aesthetic Design",
      "Error Recovery",
      "Help & Documentation",
    ];
    ruleNames.forEach((name, i) => {
      const id = i + 1;
      const div = document.createElement("div");
      div.className = "toggle-row";
      div.innerHTML = `<span class="toggle-label">${name}</span><label class="switch"><input type="checkbox" id="rule-${id}" ${
        saved[id] ? "checked" : ""
      }><span class="slider"></span></label>`;
      container.appendChild(div);
    });
  }
}

function saveToHistory(results, url) {
  let history = JSON.parse(localStorage.getItem("heuristicHistory")) || [];
  let high = 0,
    med = 0,
    low = 0;
  results.forEach((r) => {
    if (r.status === "FAIL")
      r.data.forEach((d) => {
        if (r.severity === "High") high++;
        else if (r.severity === "Medium") med++;
        else low++;
      });
  });
  const deduction = high * 8 + med * 3 + low * 1;
  const score = Math.max(0, 100 - deduction);
  history.unshift({
    id: Date.now(),
    date: new Date().toLocaleString(),
    url: url,
    score: score,
    results: results,
  });
  if (history.length > 20) history.pop();
  localStorage.setItem("heuristicHistory", JSON.stringify(history));
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem("heuristicHistory")) || [];
  const list = document.getElementById("historyList");
  list.innerHTML = "";
  if (history.length === 0) {
    list.innerHTML = '<div class="empty-state">No recent audits found.</div>';
    return;
  }
  history.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-card";
    let scoreClass =
      item.score < 50
        ? "score-bad"
        : item.score < 80
        ? "score-avg"
        : "score-good";
    card.innerHTML = `<div class="h-info"><div class="h-url" title="${item.url}">${item.url}</div><div class="h-date">${item.date}</div></div><div class="h-score ${scoreClass}">${item.score}</div>`;
    card.addEventListener("click", () => {
      evaluationData = item.results;
      pageUrl = item.url;
      showUI();
      document.getElementById("historyView").classList.add("hidden");
      document.getElementById("mainHeader").classList.remove("hidden");
      document.getElementById("mainDesc").classList.remove("hidden");
      document.getElementById("mainView").classList.remove("hidden");
      showToast("Audit Restored!");
    });
    list.appendChild(card);
  });
}

function processResults(response) {
  evaluationData = response.results.sort((a, b) => a.id - b.id);
  pageUrl = response.url;
  showUI();
}

function showUI() {
  document.getElementById("analyzeBtn").classList.add("hidden");
  document.getElementById("resultsArea").classList.remove("hidden");
  const list = document.getElementById("rulesList");
  let passedCount = 0;
  list.innerHTML = "";
  evaluationData.forEach((rule, index) => {
    if (rule.status === "PASS") passedCount++;
    const div = document.createElement("div");
    div.className = "rule-row";
    const isPass = rule.status === "PASS";
    const statusClass = isPass ? "status-pass" : "status-fail";
    const statusText = isPass ? "PASS" : "FAIL";
    const expandIcon = !isPass ? `<div class="expand-icon">▼</div>` : "";
    let html = `<div class="row-header"><div class="rule-row-left"><div class="rule-id-box ${
      isPass ? "id-pass" : "id-fail"
    }">${rule.id}</div><div class="rule-info"><span class="rule-name">${
      rule.name
    }</span><span class="sev-badge" style="color:${getSeverityColor(
      rule.severity
    )}">${
      rule.severity
    } Priority</span></div></div><div class="rule-row-right"><div class="status-badge ${statusClass}">${statusText}</div>${expandIcon}</div></div>`;
    let detailsHtml = `<div class="rule-details ${
      isPass ? "pass-context" : "fail-context"
    }" id="detail-${index}">`;
    if (!isPass) {
      rule.data.forEach((item) => {
        detailsHtml += `<div class="detail-item"><div class="issue-text"><strong>Issue:</strong> ${item.issue}</div><div class="sol-text"><strong>Fix:</strong> ${item.solution}</div></div>`;
      });
    } else {
      detailsHtml += `<div style="padding:4px; color:var(--pass-text); font-size:12px; font-weight:500;">✨ No critical violations found.</div>`;
    }
    detailsHtml += `</div>`;
    div.innerHTML = html + detailsHtml;
    div.addEventListener("click", () => {
      document.getElementById(`detail-${index}`).classList.toggle("open");
      div.classList.toggle("expanded");
    });
    list.appendChild(div);
  });
  document.getElementById(
    "statusSummary"
  ).innerText = `Passed ${passedCount} / ${evaluationData.length} Active Heuristics`;
}

function showToast(msg) {
  const toast = document.getElementById("successToast");
  document.getElementById("toastMsg").textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2000);
}

function getSeverityColor(sev) {
  if (sev === "High") return "var(--badge-fail-text)";
  if (sev === "Medium") return "#F59E0B";
  return "var(--text-sub)";
}

document.getElementById("downloadBtn").addEventListener("click", () => {
  if (!evaluationData.length) return;
  const rawName = prompt("Enter Auditor Name:", "UX Specialist");
  if (rawName === null) return;
  const clean = (str) =>
    String(str || "")
      .replace(/[^\x20-\x7E]/g, "")
      .trim();
  const auditorName = clean(rawName) || "HeuristiCheck Auditor";
  const reportDate = new Date().toLocaleString();
  const safeUrl = clean(pageUrl).substring(0, 60);
  try {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 15;
    let y = 0;
    const colBrand = [31, 58, 99];
    const colBg = [248, 249, 250];
    const colPass = [46, 175, 99];
    const setFill = (c) => doc.setFillColor(c[0], c[1], c[2]);
    const drawHeader = (pageNum) => {
      setFill(colBrand);
      doc.rect(0, 0, pageWidth, 25, "F");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.text("Heuristic Evaluation Report", margin, 16);
      doc.setFontSize(8);
      doc.text(
        `Page ${pageNum} | ${clean(reportDate)}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );
      return 40;
    };
    const checkPageBreak = (heightNeeded) => {
      if (y + heightNeeded > pageHeight - 20) {
        doc.addPage();
        currentPage++;
        y = drawHeader(currentPage);
      }
    };
    let currentPage = 1;
    y = drawHeader(currentPage);
    doc.setDrawColor(225, 229, 236);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 45, 3, 3, "FD");
    let metaY = y + 12;
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("TARGET WEBSITE", margin + 10, metaY);
    doc.text("AUDIT DATE", margin + 100, metaY);
    doc.setTextColor(31, 58, 99);
    doc.setFont("helvetica", "bold");
    doc.text(safeUrl, margin + 10, metaY + 6);
    doc.text(clean(reportDate), margin + 100, metaY + 6);
    metaY += 16;
    doc.setTextColor(120);
    doc.setFont("helvetica", "normal");
    doc.text("EVALUATOR", margin + 10, metaY);
    doc.setTextColor(31, 58, 99);
    doc.setFont("helvetica", "bold");
    doc.text(clean(auditorName), margin + 10, metaY + 6);
    y += 55;
    let highCount = 0,
      medCount = 0,
      lowCount = 0;
    evaluationData.forEach((r) => {
      if (r.status === "FAIL")
        r.data.forEach((d) => {
          if (r.severity === "High") highCount++;
          else if (r.severity === "Medium") medCount++;
          else lowCount++;
        });
    });
    const deduction = highCount * 8 + medCount * 3 + lowCount * 1;
    const score = Math.max(0, 100 - deduction);
    doc.setFontSize(12);
    doc.setTextColor(31, 58, 99);
    doc.text("Executive Summary", margin, y);
    y += 8;
    setFill(colBg);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 50, 3, 3, "F");
    let statY = y + 20;
    doc.setFontSize(36);
    doc.setTextColor(
      score > 75 ? 46 : 215,
      score > 75 ? 175 : 38,
      score > 75 ? 99 : 61
    );
    doc.setFont("helvetica", "bold");
    doc.text(`${score}`, margin + 25, statY + 5);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("Overall Score", margin + 18, statY + 15);
    const drawStatCard = (label, count, color, xPos) => {
      setFill([255, 255, 255]);
      doc.roundedRect(xPos, y + 10, 35, 30, 2, 2, "F");
      setFill(color);
      doc.circle(xPos + 18, y + 18, 3, "F");
      doc.setFontSize(16);
      doc.setTextColor(50);
      doc.text(`${count}`, xPos + 18, y + 30, { align: "center" });
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(label, xPos + 18, y + 37, { align: "center" });
    };
    drawStatCard("Critical", highCount, [215, 38, 61], margin + 60);
    drawStatCard("Major", medCount, [230, 126, 34], margin + 105);
    drawStatCard("Minor", lowCount, [31, 58, 99], margin + 150);
    y += 65;
    doc.setFontSize(14);
    doc.setTextColor(31, 58, 99);
    doc.setFont("helvetica", "bold");
    doc.text("Detailed Audit Findings", margin, y);
    doc.setLineWidth(0.5);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y + 3, pageWidth - margin, y + 3);
    y += 15;
    evaluationData.forEach((rule) => {
      checkPageBreak(25);
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.setFont("helvetica", "bold");
      doc.text(clean(`${rule.id}. ${rule.name}`), margin, y);
      const isPass = rule.status === "PASS";
      setFill(isPass ? colPass : [215, 38, 61]);
      doc.roundedRect(pageWidth - margin - 25, y - 5, 25, 7, 1, 1, "F");
      doc.setTextColor(255);
      doc.setFontSize(8);
      doc.text(rule.status, pageWidth - margin - 12.5, y, { align: "center" });
      y += 8;
      if (isPass) {
        doc.setTextColor(150);
        doc.setFont("helvetica", "italic");
        doc.text("No critical violations found.", margin + 5, y);
        y += 12;
      } else {
        rule.data.forEach((item) => {
          doc.setFontSize(10);
          const issueText = doc.splitTextToSize(
            `ISSUE: ${clean(item.issue)}`,
            pageWidth - margin * 2 - 10
          );
          const solText = doc.splitTextToSize(
            `FIX: ${clean(item.solution)}`,
            pageWidth - margin * 2 - 10
          );
          const boxHeight = issueText.length * 5 + solText.length * 5 + 10;
          checkPageBreak(boxHeight + 5);
          setFill([255, 255, 255]);
          doc.setDrawColor(225, 229, 236);
          doc.roundedRect(
            margin,
            y,
            pageWidth - margin * 2,
            boxHeight,
            2,
            2,
            "FD"
          );
          setFill(
            rule.severity === "High"
              ? [215, 38, 61]
              : rule.severity === "Medium"
              ? [230, 126, 34]
              : [31, 58, 99]
          );
          doc.rect(margin, y, 3, boxHeight, "F");
          let textY = y + 6;
          doc.setTextColor(80, 0, 0);
          doc.setFont("helvetica", "bold");
          doc.text(issueText, margin + 8, textY);
          textY += issueText.length * 5 + 2;
          doc.setTextColor(20, 80, 20);
          doc.setFont("helvetica", "normal");
          doc.text(solText, margin + 8, textY);
          y += boxHeight + 6;
        });
      }
      y += 6;
    });
    doc.save(`Heuristic_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (error) {
    console.error(error);
    alert("PDF Error: " + error.message);
  }
});

document.getElementById("csvBtn").addEventListener("click", () => {
  if (!evaluationData.length) return;
  let csv = "ID,Name,Severity,Status,Issue,Solution\n";
  evaluationData.forEach((r) => {
    if (r.status === "FAIL") {
      r.data.forEach((d) => {
        const issue = d.issue.replace(/"/g, '""');
        const sol = d.solution.replace(/"/g, '""');
        csv += `${r.id},"${r.name}",${r.severity},FAIL,"${issue}","${sol}"\n`;
      });
    } else {
      csv += `${r.id},"${r.name}",${r.severity},PASS,-,-\n`;
    }
  });
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "heuristic_audit.csv";
  a.click();
});
