/**
 * Transcript Viewer Component
 * Anthropic-themed chat-style transcript viewer
 * Usage: <div data-transcript-viewer data-transcript-urls="url1.json,url2.json"></div>
 * Or: <div data-transcript-viewer><script type="application/json">{"transcripts":[{"url":"...","id":"..."}]}</script></div>
 */
(function () {
  "use strict";

  function TranscriptViewer(container, options) {
    this.container = container;
    this.options = Object.assign({ transcripts: [] }, options);
    this.transcripts = {};
    this.currentTranscript = null;
    this.init();
  }

  TranscriptViewer.prototype.init = function () {
    this.render();
    if (this.options.transcripts.length > 0) {
      this.loadTranscripts();
    }
  };

  TranscriptViewer.prototype.render = function () {
    this.container.innerHTML =
      '<div class="transcript-viewer">' +
        '<div class="transcript-header">' +
          '<div class="transcript-header-title">Abridged Transcripts</div>' +
          '<div class="transcript-tabs"></div>' +
        '</div>' +
        '<div class="transcript-content">' +
          '<div class="transcript-loading">Loading transcripts\u2026</div>' +
        '</div>' +
      '</div>';
  };

  TranscriptViewer.prototype.loadTranscripts = function () {
    var self = this;
    var tabsContainer = this.container.querySelector(".transcript-tabs");

    this.options.transcripts.forEach(function (info) {
      fetch(info.url)
        .then(function (r) {
          if (!r.ok) throw new Error("Failed: " + r.status);
          return r.json();
        })
        .then(function (data) {
          var id = info.id || info.url;
          self.transcripts[id] = data;

          var btn = document.createElement("button");
          btn.className = "transcript-tab";
          btn.textContent = data.name || "Transcript";
          btn.onclick = function () { self.selectTranscript(id); };
          tabsContainer.appendChild(btn);

          if (!self.currentTranscript) self.selectTranscript(id);
        })
        .catch(function (err) {
          console.error("Failed to load transcript:", info.url, err);
        });
    });
  };

  TranscriptViewer.prototype.selectTranscript = function (id) {
    this.currentTranscript = id;
    var keys = Object.keys(this.transcripts);
    var tabs = this.container.querySelectorAll(".transcript-tab");
    tabs.forEach(function (tab, i) {
      tab.classList.toggle("active", keys[i] === id);
    });
    this.renderTranscript();
    var content = this.container.querySelector(".transcript-content");
    if (content) content.scrollTop = 0;
  };

  TranscriptViewer.prototype.renderTranscript = function () {
    var content = this.container.querySelector(".transcript-content");
    var transcript = this.transcripts[this.currentTranscript];
    if (!transcript || !transcript.entries) {
      content.innerHTML = '<div class="transcript-empty">No transcript data available</div>';
      return;
    }

    var html = "";
    if (transcript.description) {
      html += '<div class="transcript-description">' + escapeHtml(transcript.description) + '</div>';
    }

    html += '<div class="transcript-entries">';
    var self = this;
    transcript.entries.forEach(function (entry, i) {
      html += self.renderEntry(entry, i);
    });
    html += "</div>";
    content.innerHTML = html;
  };

  TranscriptViewer.prototype.renderEntry = function (entry) {
    var typeClass = "transcript-entry-" + (entry.type || "agent");
    var subtypeClass = entry.subtype ? "subtype-" + entry.subtype : "";
    var formatted = this.formatContent(entry);

    return '<div class="transcript-entry ' + typeClass + " " + subtypeClass + '">' +
      '<div class="entry-content">' + formatted + '</div>' +
    '</div>';
  };

  TranscriptViewer.prototype.formatContent = function (entry) {
    var content = entry.content || "";
    var suffix = entry.title_suffix ? " " + entry.title_suffix : "";

    // Format code blocks
    content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre class="code-block"><code class="language-' + (lang || "plaintext") + '">' +
        escapeHtml(code.trim()) + '</code></pre>';
    });

    // Format inline code
    content = content.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Newlines to <br> outside pre
    content = content.split(/(<pre[\s\S]*?<\/pre>)/).map(function (part, i) {
      return i % 2 === 0 ? part.replace(/\n/g, "<br>") : part;
    }).join("");

    // Add markers based on type
    var marker = "";
    if (entry.type === "agent") {
      var labels = {
        send_message: "\ud83d\udcac Chat with Target",
        thought: "\ud83d\udcad Thinking",
        think: "\ud83d\udcad Thinking",
        tool_call: "\ud83d\udd27 Tool Call",
        bash_tool: "\ud83d\udd27 Bash Command",
        code_write: "\ud83d\udcbb Writing Code",
        plan: "\ud83d\udccb Plan",
        report: "\ud83d\udccb Report",
        auditor_scratchpad: "\ud83d\udcdd Auditor Scratchpad"
      };
      var label = labels[entry.subtype];
      if (!label && entry.subtype) {
        label = "\ud83d\udd27 " + entry.subtype.replace(/[_-]/g, " ").replace(/\b\w/g, function (l) { return l.toUpperCase(); });
      }
      if (label) marker = '<div class="tool-call-marker">' + label + suffix + '</div>';
    } else if (entry.type === "result") {
      var rLabels = {
        chat_output: "\ud83e\udd16 Target Model Response",
        thinking: "\ud83d\udcad Target Thinking",
        tool_output: "\ud83d\udce4 Tool Output",
        bash_output: "\ud83d\udce4 Bash Output"
      };
      var rLabel = rLabels[entry.subtype];
      if (!rLabel && entry.subtype) {
        rLabel = "\ud83d\udce4 " + entry.subtype.replace(/_/g, " ").replace(/\b\w/g, function (l) { return l.toUpperCase(); });
      }
      if (!rLabel) rLabel = "\ud83d\udce4 Result";
      marker = '<div class="result-marker">' + rLabel + suffix + '</div>';
    } else if (entry.type === "summary") {
      if (entry.subtype === "critical_finding") {
        marker = '<div class="finding-marker critical">\u26a0\ufe0f Critical Finding' + suffix + '</div>';
      } else if (entry.subtype === "finding") {
        marker = '<div class="finding-marker">\ud83d\udd0d Finding' + suffix + '</div>';
      }
    }

    return marker + content;
  };

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Auto-init on DOMContentLoaded
  document.addEventListener("DOMContentLoaded", function () {
    var containers = document.querySelectorAll("[data-transcript-viewer]");
    containers.forEach(function (el) {
      var transcripts = [];

      // Option 1: data-transcript-urls attribute
      var urls = el.dataset.transcriptUrls;
      if (urls) {
        transcripts = urls.split(",").map(function (u) { return { url: u.trim() }; });
      }

      // Option 2: inline JSON config
      var script = el.querySelector('script[type="application/json"]');
      if (script) {
        try {
          var config = JSON.parse(script.textContent);
          if (config.transcripts) transcripts = config.transcripts;
        } catch (e) {
          console.error("Failed to parse transcript config:", e);
        }
      }

      if (transcripts.length > 0) {
        new TranscriptViewer(el, { transcripts: transcripts });
      }
    });
  });

  window.TranscriptViewer = TranscriptViewer;
})();
