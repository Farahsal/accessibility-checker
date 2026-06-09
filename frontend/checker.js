// ─────────────────────────────────────────────
// 0. BACKEND CONFIG
// ─────────────────────────────────────────────
// Point this at your running backend. When serving everything from the
// same Express process (node server.js) an empty string works because
// /api/* paths resolve relative to the page origin.
const BACKEND = window.BACKEND_URL || '';

// ─────────────────────────────────────────────
// 1. URL FETCHER — uses our own backend proxy
// ─────────────────────────────────────────────
class CORSProxy {
    /**
     * Fetch a remote URL via our own server-side proxy endpoint.
     * This completely solves CORS — the browser never touches the target site.
     * Falls back to legacy third-party proxies if the backend is unavailable.
     */
    static async fetchURL(url) {
        // ── Primary: our own backend proxy ───────
        try {
            const resp = await fetch(`${BACKEND}/api/proxy?url=${encodeURIComponent(url)}`, {
                signal: AbortSignal.timeout(20000)
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.html && data.html.length > 200) return data.html;
            }
        } catch (e) {
            console.warn('Backend proxy unavailable, falling back to third-party proxies:', e.message);
        }

        // ── Fallback: third-party CORS proxies ───
        const fallbacks = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
        ];
        for (const proxy of fallbacks) {
            try {
                const response = await fetch(proxy, { signal: AbortSignal.timeout(10000) });
                if (response.ok) {
                    const text = await response.text();
                    if (text.length > 500) return text;
                }
            } catch (e) { /* try next */ }
        }
        throw new Error('Could not fetch URL. Start the backend server (node server.js) for reliable fetching, or paste the HTML manually.');
    }
}

// ─────────────────────────────────────────────
// BACKEND API HELPERS
// ─────────────────────────────────────────────
const API = {
    /** Save an audit result to the backend database */
    async saveAudit(payload) {
        try {
            const resp = await fetch(`${BACKEND}/api/audits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000)
            });
            return resp.ok ? await resp.json() : null;
        } catch { return null; }
    },

    /** Get all past scans for a URL */
    async getHistory(url) {
        try {
            const resp = await fetch(`${BACKEND}/api/audits/history?url=${encodeURIComponent(url)}`, {
                signal: AbortSignal.timeout(5000)
            });
            return resp.ok ? await resp.json() : null;
        } catch { return null; }
    },

    /** Get global aggregate statistics */
    async getStats() {
        try {
            const resp = await fetch(`${BACKEND}/api/stats`, { signal: AbortSignal.timeout(5000) });
            return resp.ok ? await resp.json() : null;
        } catch { return null; }
    },

    /** Check if backend is reachable */
    async isReachable() {
        try {
            const resp = await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(3000) });
            return resp.ok;
        } catch { return false; }
    }
};

// ─────────────────────────────────────────────
// 2. ACCESSIBILITY CHECKER ENGINE
// ─────────────────────────────────────────────
class AccessibilityChecker {
    constructor() {
        this.issues = { critical: [], serious: [], moderate: [] };
        this.passed = [];
    }

    check(htmlString) {
        this.issues = { critical: [], serious: [], moderate: [] };
        this.passed = [];

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        this.checkImages(doc);
        this.checkHeadings(doc);
        this.checkContrast(doc);
        this.checkForms(doc);
        this.checkLinks(doc);
        this.checkLanguage(doc);
        this.checkButtons(doc);
        this.checkTabIndex(doc);
        this.checkARIA(doc);
        this.checkSkipLinks(doc);

        return this.generateReport();
    }

    // 1. IMAGE ALT TEXT — WCAG 1.1.1 (Level A)
    checkImages(doc) {
        const images = doc.querySelectorAll('img');
        images.forEach((img, index) => {
            const src = img.getAttribute('src') || 'unknown';
            const alt = img.getAttribute('alt');

            if (!img.hasAttribute('alt')) {
                this.issues.critical.push({
                    type: 'Missing Alt Text',
                    description: 'Image is missing the alt attribute entirely. Screen readers cannot interpret this image.',
                    element: `<img src="${src}">`,
                    wcag: 'WCAG 2.1 - 1.1.1 Non-text Content (Level A)',
                    howToFix: 'Add an alt attribute with descriptive text, or alt="" for decorative images.',
                    location: `Image #${index + 1}`
                });
            } else if (alt && (
                alt.toLowerCase().includes('image') ||
                alt.toLowerCase().includes('picture') ||
                alt.toLowerCase().includes('photo') ||
                alt === src ||
                alt.match(/\.(jpg|jpeg|png|gif|svg)$/i)
            )) {
                this.issues.serious.push({
                    type: 'Poor Alt Text Quality',
                    description: `Alt text "${alt}" is not descriptive. Avoid using words like "image" or file names.`,
                    element: `<img src="${src}" alt="${alt}">`,
                    wcag: 'WCAG 2.1 - 1.1.1 Non-text Content (Level A)',
                    howToFix: 'Use descriptive alt text that conveys the meaning of the image.',
                    location: `Image #${index + 1}`
                });
            } else if (alt === '' && !img.hasAttribute('role')) {
                this.issues.moderate.push({
                    type: 'Empty Alt Text',
                    description: 'Image has empty alt text but no role="presentation" or role="none". Is this truly decorative?',
                    element: `<img src="${src}" alt="">`,
                    wcag: 'WCAG 2.1 - 1.1.1 Non-text Content (Level A)',
                    howToFix: 'If decorative, add role="presentation". Otherwise, add descriptive alt text.',
                    location: `Image #${index + 1}`
                });
            } else if (alt && alt.trim().length > 0) {
                this.passed.push(`Image has proper alt text: "${alt}"`);
            }
        });
        if (images.length === 0) this.passed.push('No images found to check');
    }

    // 2. HEADING STRUCTURE — WCAG 1.3.1, 2.4.6
    checkHeadings(doc) {
        const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const headingLevels = Array.from(headings).map(h => parseInt(h.tagName[1]));
        const h1Count = headingLevels.filter(l => l === 1).length;

        if (h1Count === 0) {
            this.issues.serious.push({
                type: 'Missing H1 Heading',
                description: 'Page has no H1 heading. Every page should have exactly one H1.',
                element: 'N/A',
                wcag: 'WCAG 2.1 - 2.4.6 Headings and Labels (Level AA)',
                howToFix: 'Add an H1 heading that describes the main content of the page.',
                location: 'Document'
            });
        } else if (h1Count > 1) {
            this.issues.moderate.push({
                type: 'Multiple H1 Headings',
                description: `Found ${h1Count} H1 headings. Best practice is to have only one H1 per page.`,
                element: 'Multiple H1 elements',
                wcag: 'WCAG 2.1 - 1.3.1 Info and Relationships (Level A)',
                howToFix: 'Use only one H1 for the main page title, use H2–H6 for subsections.',
                location: 'Document'
            });
        } else {
            this.passed.push('Page has exactly one H1 heading');
        }

        for (let i = 1; i < headingLevels.length; i++) {
            if (headingLevels[i] - headingLevels[i - 1] > 1) {
                this.issues.serious.push({
                    type: 'Heading Level Skipped',
                    description: `Heading jumps from H${headingLevels[i-1]} to H${headingLevels[i]}.`,
                    element: headings[i].outerHTML,
                    wcag: 'WCAG 2.1 - 1.3.1 Info and Relationships (Level A)',
                    howToFix: 'Ensure heading levels increase incrementally (H1 → H2 → H3, etc.)',
                    location: `Heading #${i + 1}`
                });
            }
        }

        headings.forEach((heading, index) => {
            if (!heading.textContent.trim()) {
                this.issues.critical.push({
                    type: 'Empty Heading',
                    description: 'Heading element has no text content.',
                    element: heading.outerHTML,
                    wcag: 'WCAG 2.1 - 2.4.6 Headings and Labels (Level AA)',
                    howToFix: 'Add descriptive text to the heading or remove it.',
                    location: `Heading #${index + 1}`
                });
            }
        });

        if (headings.length > 0 && !this.issues.serious.some(i => i.type.includes('Heading'))) {
            this.passed.push('Heading hierarchy is properly structured');
        }
    }

    // 3. COLOR CONTRAST (inline styles only) — WCAG 1.4.3, 1.4.6
    checkContrast(doc) {
        const textElements = doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,a,span,li,td,th,button,label');
        let contrastIssues = 0;

        textElements.forEach((element, index) => {
            const style = element.getAttribute('style');
            if (style && style.includes('color')) {
                const bgColor = this.extractColor(style, 'background-color');
                const fgColor = this.extractColor(style, 'color');
                if (bgColor && fgColor) {
                    const ratio = this.calculateContrastRatio(fgColor, bgColor);
                    const fontSize = this.getFontSize(element);
                    const isLargeText = fontSize >= 18 || (fontSize >= 14 && element.style.fontWeight === 'bold');
                    const requiredAA  = isLargeText ? 3 : 4.5;
                    const requiredAAA = isLargeText ? 4.5 : 7;

                    if (ratio < requiredAA) {
                        contrastIssues++;
                        this.issues.serious.push({
                            type: 'Insufficient Color Contrast (AA)',
                            description: `Contrast ratio ${ratio.toFixed(2)}:1 is below the required ${requiredAA}:1 for ${isLargeText ? 'large' : 'normal'} text.`,
                            element: element.outerHTML.substring(0, 100) + '...',
                            wcag: 'WCAG 2.1 - 1.4.3 Contrast Minimum (Level AA)',
                            howToFix: `Increase contrast to at least ${requiredAA}:1.`,
                            location: `Element #${index + 1}`,
                            details: `Current: ${ratio.toFixed(2)}:1 | Required: ${requiredAA}:1 (AA) / ${requiredAAA}:1 (AAA)`
                        });
                    } else if (ratio < requiredAAA) {
                        this.issues.moderate.push({
                            type: 'Below AAA Contrast Standard',
                            description: `Contrast ratio ${ratio.toFixed(2)}:1 meets AA but not AAA standards.`,
                            element: element.outerHTML.substring(0, 100) + '...',
                            wcag: 'WCAG 2.1 - 1.4.6 Contrast Enhanced (Level AAA)',
                            howToFix: `Increase contrast to ${requiredAAA}:1 to meet AAA.`,
                            location: `Element #${index + 1}`,
                            details: `Current: ${ratio.toFixed(2)}:1 | Required: ${requiredAAA}:1 (AAA)`
                        });
                    }
                }
            }
        });

        if (contrastIssues === 0) {
            this.passed.push('No contrast issues detected in inline styles (note: CSS class-based colours are not checked)');
        }
    }

    calculateContrastRatio(c1, c2) {
        const l1 = this.getLuminance(c1), l2 = this.getLuminance(c2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    getLuminance(color) {
        const rgb = this.parseColor(color);
        if (!rgb) return 0;
        return rgb.map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    }

    parseColor(str) {
        if (!str) return null;
        const rgb = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
        const hex = str.match(/#([0-9a-f]{6})/i);
        if (hex) return [parseInt(hex[1].substr(0,2),16), parseInt(hex[1].substr(2,2),16), parseInt(hex[1].substr(4,2),16)];
        return null;
    }

    extractColor(style, prop) {
        const m = style.match(new RegExp(prop + ':\\s*([^;]+)'));
        return m ? m[1].trim() : null;
    }

    getFontSize(el) {
        const s = el.getAttribute('style');
        if (s && s.includes('font-size')) {
            const m = s.match(/font-size:\s*(\d+)/);
            return m ? parseInt(m[1]) : 16;
        }
        return 16;
    }

    // 4. FORM LABELS — WCAG 1.3.1, 3.3.2
    checkForms(doc) {
        const inputs = doc.querySelectorAll('input:not([type="hidden"]), select, textarea');
        inputs.forEach((input, index) => {
            const id = input.getAttribute('id');
            const type = input.getAttribute('type');
            let hasLabel = !!(input.getAttribute('aria-label') || input.getAttribute('aria-labelledby'));

            if (!hasLabel && id && doc.querySelector(`label[for="${id}"]`)) hasLabel = true;

            if (!hasLabel) {
                let parent = input.parentElement;
                while (parent) {
                    if (parent.tagName === 'LABEL') { hasLabel = true; break; }
                    parent = parent.parentElement;
                }
            }

            if (!hasLabel) {
                this.issues.critical.push({
                    type: 'Form Input Missing Label',
                    description: `Form ${type || 'input'} has no associated label.`,
                    element: input.outerHTML,
                    wcag: 'WCAG 2.1 - 3.3.2 Labels or Instructions (Level A)',
                    howToFix: 'Add a <label for="id"> or use aria-label.',
                    location: `Form element #${index + 1}`
                });
            } else {
                this.passed.push(`Form ${type || 'input'} has proper label`);
            }
        });

        const radios = doc.querySelectorAll('input[type="radio"]');
        const checkboxes = doc.querySelectorAll('input[type="checkbox"]');
        if ((radios.length > 1 || checkboxes.length > 1) && doc.querySelectorAll('fieldset').length === 0) {
            this.issues.moderate.push({
                type: 'Missing Fieldset for Form Groups',
                description: 'Radio buttons or checkboxes should be grouped in a <fieldset> with a <legend>.',
                element: 'Multiple radio/checkbox inputs',
                wcag: 'WCAG 2.1 - 1.3.1 Info and Relationships (Level A)',
                howToFix: 'Wrap related controls in <fieldset> and add <legend>.',
                location: 'Form'
            });
        }
    }

    // 5. LINKS — WCAG 2.4.4, 2.4.9
    checkLinks(doc) {
        doc.querySelectorAll('a').forEach((link, index) => {
            const href = link.getAttribute('href');
            const text = link.textContent.trim();
            const ariaLabel = link.getAttribute('aria-label');
            const title = link.getAttribute('title');

            if (!href) {
                this.issues.serious.push({
                    type: 'Link Missing href',
                    description: 'Link has no href and is not keyboard accessible.',
                    element: link.outerHTML,
                    wcag: 'WCAG 2.1 - 2.1.1 Keyboard (Level A)',
                    howToFix: 'Add href or convert to a <button>.',
                    location: `Link #${index + 1}`
                });
            }

            if (!text && !ariaLabel && !title) {
                this.issues.critical.push({
                    type: 'Empty Link Text',
                    description: 'Link has no text. Screen reader users cannot determine its destination.',
                    element: link.outerHTML,
                    wcag: 'WCAG 2.1 - 2.4.4 Link Purpose (Level A)',
                    howToFix: 'Add descriptive text, aria-label, or title.',
                    location: `Link #${index + 1}`
                });
            } else if (text && ['click here','read more','more','link'].includes(text.toLowerCase())) {
                this.issues.serious.push({
                    type: 'Non-descriptive Link Text',
                    description: `Link text "${text}" is not descriptive out of context.`,
                    element: link.outerHTML,
                    wcag: 'WCAG 2.1 - 2.4.9 Link Purpose (Link Only) (Level AAA)',
                    howToFix: 'Use text that explains where the link goes.',
                    location: `Link #${index + 1}`
                });
            }

            if (link.getAttribute('target') === '_blank') {
                const label = ariaLabel || '';
                if (!label.includes('new window') && !label.includes('new tab')) {
                    this.issues.moderate.push({
                        type: 'New Window Without Warning',
                        description: 'Link opens in new tab/window but does not warn users.',
                        element: link.outerHTML,
                        wcag: 'WCAG 2.1 - 3.2.5 Change on Request (Level AAA)',
                        howToFix: 'Add aria-label or visible text indicating it opens in a new tab.',
                        location: `Link #${index + 1}`
                    });
                }
            }
        });
    }

    // 6. LANGUAGE — WCAG 3.1.1
    checkLanguage(doc) {
        const lang = doc.querySelector('html')?.getAttribute('lang');
        if (!lang) {
            this.issues.serious.push({
                type: 'Missing Language Attribute',
                description: 'HTML element is missing the lang attribute.',
                element: '<html>',
                wcag: 'WCAG 2.1 - 3.1.1 Language of Page (Level A)',
                howToFix: 'Add lang="en" (or appropriate code) to the <html> tag.',
                location: 'Document root'
            });
        } else {
            this.passed.push(`Document language is set to: ${lang}`);
        }
    }

    // 7. BUTTONS — WCAG 4.1.2
    checkButtons(doc) {
        doc.querySelectorAll('button, [role="button"]').forEach((btn, index) => {
            if (!btn.textContent.trim() && !btn.getAttribute('aria-label') && !btn.getAttribute('title')) {
                this.issues.critical.push({
                    type: 'Button Without Accessible Name',
                    description: 'Button has no text, aria-label, or title.',
                    element: btn.outerHTML,
                    wcag: 'WCAG 2.1 - 4.1.2 Name, Role, Value (Level A)',
                    howToFix: 'Add text content or aria-label describing the button\'s action.',
                    location: `Button #${index + 1}`
                });
            }
        });
    }

    // 8. TABINDEX — WCAG 2.4.3
    checkTabIndex(doc) {
        doc.querySelectorAll('[tabindex]').forEach((el, index) => {
            if (parseInt(el.getAttribute('tabindex')) > 0) {
                this.issues.serious.push({
                    type: 'Positive tabindex Value',
                    description: `Element has tabindex="${el.getAttribute('tabindex')}". Positive values disrupt natural tab order.`,
                    element: el.outerHTML.substring(0, 100) + '...',
                    wcag: 'WCAG 2.1 - 2.4.3 Focus Order (Level A)',
                    howToFix: 'Use tabindex="0" or tabindex="-1". Never use positive values.',
                    location: `Element #${index + 1}`
                });
            }
        });
    }

    // 9. ARIA — WCAG 4.1.2
    checkARIA(doc) {
        const validRoles = ['alert','button','checkbox','dialog','link','navigation','main','banner','contentinfo','search','tabpanel','tab','tablist','region','complementary','form','article','heading','img','list','listitem','menuitem','none','presentation','progressbar','radio','radiogroup','slider','spinbutton','status','switch','table','textbox','timer','tooltip','tree','treeitem'];
        doc.querySelectorAll('[role]').forEach((el, index) => {
            const role = el.getAttribute('role');
            if (role && !validRoles.includes(role)) {
                this.issues.moderate.push({
                    type: 'Potentially Invalid ARIA Role',
                    description: `Role "${role}" may not be a valid ARIA role.`,
                    element: el.outerHTML.substring(0, 100) + '...',
                    wcag: 'WCAG 2.1 - 4.1.2 Name, Role, Value (Level A)',
                    howToFix: 'Verify this is a valid ARIA role from the WAI-ARIA spec.',
                    location: `Element #${index + 1}`
                });
            }
        });
    }

    // 10. SKIP LINKS — WCAG 2.4.1
    checkSkipLinks(doc) {
        let hasSkip = false;
        doc.querySelectorAll('a[href^="#"]').forEach(link => {
            const t = link.textContent.trim().toLowerCase();
            if (t.includes('skip to main') || t.includes('skip to content') || t.includes('skip navigation')) {
                hasSkip = true;
            }
        });

        if (!hasSkip) {
            this.issues.moderate.push({
                type: 'Missing Skip Link',
                description: 'Page has no "skip to main content" link for keyboard users.',
                element: 'N/A',
                wcag: 'WCAG 2.1 - 2.4.1 Bypass Blocks (Level A)',
                howToFix: 'Add <a href="#main">Skip to main content</a> as the first focusable element.',
                location: 'Document'
            });
        } else {
            this.passed.push('Skip navigation link is present');
        }
    }

    generateReport() {
        return {
            summary: {
                total: this.issues.critical.length + this.issues.serious.length + this.issues.moderate.length,
                critical: this.issues.critical.length,
                serious: this.issues.serious.length,
                moderate: this.issues.moderate.length,
                passed: this.passed.length
            },
            issues: this.issues,
            passed: this.passed
        };
    }
}

// ─────────────────────────────────────────────
// 3. HELPER UTILITIES
// ─────────────────────────────────────────────
function calculateScore(report) {
    const score = 100 - (report.summary.critical * 15) - (report.summary.serious * 5) - (report.summary.moderate * 2);
    return Math.max(0, Math.min(100, score));
}

function getScoreColor(score) {
    if (score >= 90) return '#44c87a';
    if (score >= 70) return '#8BC34A';
    if (score >= 50) return '#FFC107';
    if (score >= 30) return '#FF9800';
    return '#e8445a';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading(container, message) {
    container.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <p>${message || 'Analysing accessibility…'}</p>
        </div>`;
}

// ─────────────────────────────────────────────
// 4. RESULT RENDERING
// ─────────────────────────────────────────────
function displayResults(report, container, sourceBanner) {
    const el = container || document.getElementById('results');

    if (report.summary.total === 0) {
        el.innerHTML = `
            <div class="no-issues">
                <h3>✅ No issues found</h3>
                <p>The analysed content passed all accessibility checks.</p>
            </div>`;
        return;
    }

    let html = '';
    if (sourceBanner) html += sourceBanner;

    html += `
        <div class="summary">
            <div class="summary-card">
                <h3>Total Issues</h3>
                <div class="count">${report.summary.total}</div>
            </div>
            <div class="summary-card errors">
                <h3>Critical</h3>
                <div class="count">${report.summary.critical}</div>
            </div>
            <div class="summary-card warnings">
                <h3>Serious</h3>
                <div class="count">${report.summary.serious}</div>
            </div>
            <div class="summary-card passed">
                <h3>Passed</h3>
                <div class="count">${report.summary.passed}</div>
            </div>
        </div>`;

    if (report.issues.critical.length > 0) html += generateIssueGroup('Critical Issues', report.issues.critical, 'critical');
    if (report.issues.serious.length  > 0) html += generateIssueGroup('Serious Issues',  report.issues.serious,  'serious');
    if (report.issues.moderate.length > 0) html += generateIssueGroup('Moderate Issues', report.issues.moderate, 'moderate');

    el.innerHTML = html;
}

function generateIssueGroup(title, issues, severity) {
    let html = `
        <div class="issue-group">
            <div class="issue-header">
                <h3>${title}</h3>
                <span class="severity-badge severity-${severity}">${severity}</span>
            </div>`;

    issues.forEach(issue => {
        html += `
            <div class="issue-item">
                <strong>${escapeHtml(issue.type)}</strong>
                <div class="issue-description">${escapeHtml(issue.description)}</div>
                ${issue.element && issue.element !== 'N/A'
                    ? `<div class="issue-code">${escapeHtml(issue.element)}</div>` : ''}
                <div style="margin-top:10px;"><strong>How to fix:</strong> ${escapeHtml(issue.howToFix)}</div>
                ${issue.details ? `<div style="margin-top:5px;color:var(--text-muted);font-size:0.9rem;">${escapeHtml(issue.details)}</div>` : ''}
                <span class="wcag-reference">${escapeHtml(issue.wcag)}</span>
            </div>`;
    });

    return html + '</div>';
}

// ─────────────────────────────────────────────
// 5. COMPARISON FUNCTIONS
// ─────────────────────────────────────────────
let comparisonData = { siteA: null, siteB: null };
let currentChart = null;

async function fetchSiteForComparison(side, url) {
    if (!url) { alert(`Please enter a URL for ${side === 'siteA' ? 'Site A' : 'Site B'}`); return; }

    const previewDiv = document.getElementById(`${side}Preview`);
    showLoading(previewDiv, `Fetching ${url}…`);

    let html, sourceLabel;
    try {
        html = await CORSProxy.fetchURL(url);
        sourceLabel = '<span class="source-tag tag-live">live</span>';
    } catch (e) {
        previewDiv.innerHTML = `<div class="error-box" style="margin-top:10px;">
            <strong>⚠ Could not fetch site</strong><br>${escapeHtml(e.message)}
        </div>`;
        return;
    }

    const checker = new AccessibilityChecker();
    const report = checker.check(html);
    report.url = url;
    comparisonData[side] = report;

    const score = calculateScore(report);

    // Save to backend so history is tracked
    await API.saveAudit({
        url,
        score,
        critical: report.summary.critical,
        serious:  report.summary.serious,
        moderate: report.summary.moderate,
        passed:   report.summary.passed,
        issues:   report.issues,
        source:   'compare'
    });

    // Check if this URL has history
    const histData = await API.getHistory(url);
    const scanCount = histData?.count || 1;

    previewDiv.innerHTML = `
        <div style="background:var(--surface-raised);border:1px solid var(--border);padding:15px;margin-top:10px;border-radius:4px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <strong>${side === 'siteA' ? 'Site A' : 'Site B'} loaded</strong>
                <div>${sourceLabel} <span style="font-size:0.72rem;color:var(--text-muted);">${scanCount} scan${scanCount > 1 ? 's' : ''} in history</span></div>
            </div>
            Score: <span style="font-size:1.6rem;font-weight:bold;color:${getScoreColor(score)}">${score}/100</span><br>
            <span style="font-size:0.85rem;color:var(--text-muted);">
                Critical: ${report.summary.critical} · Serious: ${report.summary.serious} · Moderate: ${report.summary.moderate}
            </span>
            ${histData && histData.count > 1 ? renderHistoryBanner(histData.history, url) : ''}
        </div>`;
}

function compareSites() {
    if (!comparisonData.siteA || !comparisonData.siteB) {
        alert('Please fetch both sites first.');
        return;
    }

    const { siteA: rA, siteB: rB } = comparisonData;
    const scoreA = calculateScore(rA), scoreB = calculateScore(rB);
    const winnerUrl = scoreA >= scoreB ? rA.url : rB.url;

    const out = document.getElementById('comparisonResults');
    out.innerHTML = `
        <div style="background:rgba(0,200,150,0.08);border:1px solid rgba(0,200,150,0.2);padding:16px;text-align:center;border-radius:4px;margin-bottom:20px;">
            <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">Better accessibility</div>
            <h2 style="font-size:1.1rem;">${escapeHtml(winnerUrl)}</h2>
            <div style="font-size:0.85rem;color:var(--text-muted);">by ${Math.abs(scoreA - scoreB)} points</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
            ${[{ r: rA, label: 'A' }, { r: rB, label: 'B' }].map(({ r, label }) => `
                <div style="border:1px solid var(--border);padding:16px;border-radius:4px;">
                    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">Site ${label}</div>
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.85rem;margin-bottom:8px;">${escapeHtml(r.url || '')}</div>
                    <div style="font-size:2.5rem;font-weight:bold;color:${getScoreColor(calculateScore(r))}">${calculateScore(r)}/100</div>
                    <div style="height:6px;background:var(--border);border-radius:99px;margin:8px 0;overflow:hidden;">
                        <div style="height:100%;width:${calculateScore(r)}%;background:${getScoreColor(calculateScore(r))};border-radius:99px;"></div>
                    </div>
                    <div style="font-size:0.82rem;color:var(--text-muted);">
                        Critical: ${r.summary.critical} · Serious: ${r.summary.serious} · Moderate: ${r.summary.moderate} · Passed: ${r.summary.passed}
                    </div>
                </div>`).join('')}
        </div>
        <div style="margin-top:24px;">
            <canvas id="comparisonChart" style="max-height:350px;"></canvas>
        </div>`;

    if (currentChart) currentChart.destroy();
    const ctx = document.getElementById('comparisonChart')?.getContext('2d');
    if (ctx) {
        currentChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Critical', 'Serious', 'Moderate', 'Passed'],
                datasets: [
                    { label: rA.url, data: [rA.summary.critical, rA.summary.serious, rA.summary.moderate, rA.summary.passed], backgroundColor: 'rgba(33,150,243,0.6)', borderColor: '#2196F3', borderWidth: 1 },
                    { label: rB.url, data: [rB.summary.critical, rB.summary.serious, rB.summary.moderate, rB.summary.passed], backgroundColor: 'rgba(76,175,80,0.6)', borderColor: '#4CAF50', borderWidth: 1 }
                ]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
    }
}

// ─────────────────────────────────────────────
// 6. HISTORY BANNER — shows trend for a URL
// ─────────────────────────────────────────────
function renderHistoryBanner(history, url) {
    if (!history || history.length < 2) return '';

    const latest = history[0];
    const prev   = history[1];
    const delta  = latest.score - prev.score;
    const arrow  = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
    const color  = delta > 0 ? 'var(--passed)' : delta < 0 ? 'var(--critical)' : 'var(--text-muted)';

    // Sparkline data (up to 8 most recent, oldest→newest)
    const sparkData = [...history].reverse().slice(-8);

    const points = sparkData.map((d, i) => {
        const x = (i / (sparkData.length - 1 || 1)) * 180 + 10;
        const y = 50 - (d.score / 100) * 40;
        return `${x},${y}`;
    }).join(' ');

    const dots = sparkData.map((d, i) => {
        const x = (i / (sparkData.length - 1 || 1)) * 180 + 10;
        const y = 50 - (d.score / 100) * 40;
        return `<circle cx="${x}" cy="${y}" r="3" fill="${getScoreColor(d.score)}" title="Score: ${d.score}"/>`;
    }).join('');

    return `
    <div style="background:var(--surface-raised);border:1px solid var(--border);padding:16px 20px;margin-bottom:16px;border-radius:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;">SCAN HISTORY — ${escapeHtml(url)}</div>
                <div style="display:flex;align-items:baseline;gap:12px;">
                    <span style="font-size:1.8rem;font-weight:bold;color:${getScoreColor(latest.score)}">${latest.score}/100</span>
                    <span style="font-size:1rem;color:${color};font-weight:bold;">${arrow} ${Math.abs(delta)} pts vs last scan</span>
                    <span style="font-size:0.78rem;color:var(--text-muted);">${history.length} total scan${history.length > 1 ? 's' : ''}</span>
                </div>
            </div>
            <svg width="200" height="60" style="overflow:visible">
                <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.6"/>
                ${dots}
            </svg>
        </div>
        <div style="margin-top:10px;overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <thead>
                    <tr style="color:var(--text-muted);">
                        <th style="text-align:left;padding:4px 8px;">Date</th>
                        <th style="padding:4px 8px;">Score</th>
                        <th style="padding:4px 8px;">Critical</th>
                        <th style="padding:4px 8px;">Serious</th>
                        <th style="padding:4px 8px;">Moderate</th>
                    </tr>
                </thead>
                <tbody>
                    ${history.slice(0, 6).map((h, idx) => `
                    <tr style="border-top:1px solid var(--border);${idx === 0 ? 'font-weight:bold;' : ''}">
                        <td style="padding:5px 8px;color:var(--text-muted);">${new Date(h.scanned_at).toLocaleDateString()} ${new Date(h.scanned_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
                        <td style="text-align:center;padding:5px 8px;color:${getScoreColor(h.score)}">${h.score}/100</td>
                        <td style="text-align:center;padding:5px 8px;color:var(--critical)">${h.critical}</td>
                        <td style="text-align:center;padding:5px 8px;color:var(--serious)">${h.serious}</td>
                        <td style="text-align:center;padding:5px 8px;color:var(--moderate)">${h.moderate}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────
// 6. ACCUMULATED STATISTICS (backend-driven)
// ─────────────────────────────────────────────
let statsCharts = [];

async function loadStatistics() {
    const resultsDiv = document.getElementById('statisticsResults');
    showLoading(resultsDiv, 'Loading statistics from database…');

    const stats = await API.getStats();

    if (!stats) {
        resultsDiv.innerHTML = `
            <div class="error-box">
                <strong>⚠ Backend not reachable</strong><br><br>
                Statistics are powered by the backend server. Start it with:<br>
                <code style="display:block;margin-top:8px;padding:8px;background:rgba(0,0,0,0.3);">cd backend &amp;&amp; npm install &amp;&amp; node server.js</code><br>
                Then run some URL checks — every scan is stored and contributes to the statistics here.
            </div>`;
        return;
    }

    const t = stats.totals;

    if (!t.total_scans || t.total_scans === 0) {
        resultsDiv.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:16px;">📊</div>
                <h3 style="color:var(--text);margin-bottom:8px;">No scans yet</h3>
                <p>Go to the <strong>Check by URL</strong> tab and scan some websites.<br>
                Every scan is automatically saved here and builds up your statistics over time.</p>
            </div>`;
        return;
    }

    // Destroy previous charts to avoid canvas reuse error
    statsCharts.forEach(c => c.destroy());
    statsCharts = [];

    const avgColor = getScoreColor(t.avg_score || 0);

    let html = `
        <!-- Overview cards -->
        <div class="summary" style="margin-bottom:28px;">
            <div class="summary-card" style="border-left-color:var(--accent)">
                <h3>Total Scans</h3>
                <div class="count">${t.total_scans}</div>
            </div>
            <div class="summary-card" style="border-left-color:var(--text-muted)">
                <h3>Unique URLs</h3>
                <div class="count">${t.unique_urls}</div>
            </div>
            <div class="summary-card" style="border-left-color:${avgColor}">
                <h3>Avg Score</h3>
                <div class="count" style="color:${avgColor}">${t.avg_score ?? '—'}/100</div>
            </div>
            <div class="summary-card" style="border-left-color:var(--critical)">
                <h3>Total Critical Issues</h3>
                <div class="count" style="color:var(--critical)">${t.total_critical || 0}</div>
            </div>
        </div>

        <!-- Charts row -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px;">
            <div style="background:var(--surface-raised);border:1px solid var(--border);padding:16px;border-radius:4px;">
                <h3 style="font-size:0.85rem;margin-bottom:12px;color:var(--text-muted);">SCORE DISTRIBUTION</h3>
                <canvas id="distChart" style="max-height:200px;"></canvas>
            </div>
            <div style="background:var(--surface-raised);border:1px solid var(--border);padding:16px;border-radius:4px;">
                <h3 style="font-size:0.85rem;margin-bottom:12px;color:var(--text-muted);">TOP RECURRING ISSUES</h3>
                <canvas id="issuesChart" style="max-height:200px;"></canvas>
            </div>
        </div>

        <!-- Most-scanned sites table -->
        <div style="background:var(--surface-raised);border:1px solid var(--border);padding:16px;border-radius:4px;margin-bottom:28px;">
            <h3 style="font-size:0.85rem;margin-bottom:12px;color:var(--text-muted);">MOST-TRACKED SITES</h3>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                    <thead>
                        <tr style="color:var(--text-muted);border-bottom:1px solid var(--border);">
                            <th style="text-align:left;padding:6px 10px;">URL</th>
                            <th style="padding:6px 10px;">Scans</th>
                            <th style="padding:6px 10px;">Avg Score</th>
                            <th style="padding:6px 10px;">Last Scanned</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(stats.topSites || []).map(s => `
                        <tr style="border-bottom:1px solid var(--border);">
                            <td style="padding:7px 10px;">
                                <a href="${escapeHtml(s.url || '')}" target="_blank" style="color:var(--accent)">${escapeHtml(s.label || s.url_normalized || s.url || 'Pasted HTML')}</a>
                            </td>
                            <td style="text-align:center;padding:7px 10px;">${s.scan_count}</td>
                            <td style="text-align:center;padding:7px 10px;color:${getScoreColor(s.avg_score)};font-weight:bold;">${s.avg_score}/100</td>
                            <td style="text-align:center;padding:7px 10px;color:var(--text-muted);font-size:0.75rem;">${new Date(s.last_scanned).toLocaleDateString()}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Recent scans -->
        <div style="background:var(--surface-raised);border:1px solid var(--border);padding:16px;border-radius:4px;">
            <h3 style="font-size:0.85rem;margin-bottom:12px;color:var(--text-muted);">RECENT SCANS</h3>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                    <thead>
                        <tr style="color:var(--text-muted);border-bottom:1px solid var(--border);">
                            <th style="text-align:left;padding:6px 10px;">URL / Source</th>
                            <th style="padding:6px 10px;">Score</th>
                            <th style="padding:6px 10px;">Critical</th>
                            <th style="padding:6px 10px;">Serious</th>
                            <th style="padding:6px 10px;">Type</th>
                            <th style="padding:6px 10px;">When</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(stats.recentScans || []).map(s => `
                        <tr style="border-bottom:1px solid var(--border);">
                            <td style="padding:6px 10px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                                ${s.url
                                    ? `<a href="${escapeHtml(s.url)}" target="_blank" style="color:var(--accent)">${escapeHtml(s.label || s.url)}</a>`
                                    : `<span style="color:var(--text-muted)">Pasted HTML</span>`}
                            </td>
                            <td style="text-align:center;padding:6px 10px;color:${getScoreColor(s.score)};font-weight:bold;">${s.score}/100</td>
                            <td style="text-align:center;padding:6px 10px;color:var(--critical)">${s.critical}</td>
                            <td style="text-align:center;padding:6px 10px;color:var(--serious)">${s.serious}</td>
                            <td style="text-align:center;padding:6px 10px;">
                                <span class="source-tag ${s.source === 'url' ? 'tag-live' : 'tag-ai'}">${escapeHtml(s.source)}</span>
                            </td>
                            <td style="text-align:center;padding:6px 10px;color:var(--text-muted);font-size:0.75rem;">${new Date(s.scanned_at).toLocaleDateString()}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;

    resultsDiv.innerHTML = html;

    // ── Score distribution doughnut ──
    const distCtx = document.getElementById('distChart')?.getContext('2d');
    if (distCtx && stats.distribution?.length) {
        const bucketColors = { 'Excellent (90-100)': '#44c87a', 'Good (70-89)': '#8BC34A', 'Fair (50-69)': '#FFC107', 'Poor (30-49)': '#FF9800', 'Critical (0-29)': '#e8445a' };
        statsCharts.push(new Chart(distCtx, {
            type: 'doughnut',
            data: {
                labels: stats.distribution.map(d => d.bucket),
                datasets: [{ data: stats.distribution.map(d => d.count), backgroundColor: stats.distribution.map(d => bucketColors[d.bucket] || '#888'), borderWidth: 0 }]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } } }
        }));
    }

    // ── Top issue types horizontal bar ──
    const issCtx = document.getElementById('issuesChart')?.getContext('2d');
    if (issCtx && stats.topIssueTypes?.length) {
        const top5 = stats.topIssueTypes.slice(0, 6);
        statsCharts.push(new Chart(issCtx, {
            type: 'bar',
            data: {
                labels: top5.map(i => i.type.length > 22 ? i.type.slice(0, 22) + '…' : i.type),
                datasets: [{ data: top5.map(i => i.count), backgroundColor: 'rgba(232,68,90,0.7)', borderRadius: 3 }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
            }
        }));
    }
}

// ─────────────────────────────────────────────
// 7. SINGLE DOMContentLoaded — all listeners here
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // ── Backend status indicator ──
    (async () => {
        const el = document.getElementById('backendStatus');
        if (!el) return;
        const alive = await API.isReachable();
        if (alive) {
            el.innerHTML = `<span style="color:var(--passed)">● backend connected — scans are being saved</span>`;
        } else {
            el.innerHTML = `<span style="color:var(--moderate)">● backend offline — <a href="#" style="color:var(--moderate)" onclick="document.querySelectorAll('.tab')[3].click();return false;">see setup</a></span>`;
        }
    })();

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // ── Check URL ──
    document.getElementById('checkUrlBtn').addEventListener('click', async () => {
        const url = document.getElementById('urlInput').value.trim();
        if (!url) { alert('Please enter a URL'); return; }

        const btn = document.getElementById('checkUrlBtn');
        const resultsDiv = document.getElementById('results');
        btn.disabled = true;
        showLoading(resultsDiv, `Fetching ${url}…`);

        let html, sourceBanner;
        try {
            html = await CORSProxy.fetchURL(url);
            sourceBanner = `<div class="warn-box" style="background:rgba(0,200,150,0.06);border-color:rgba(0,200,150,0.25);color:var(--accent);">
                ✓ Live HTML fetched from <strong>${escapeHtml(url)}</strong>
            </div>`;
        } catch (fetchErr) {
            resultsDiv.innerHTML = `
                <div class="error-box">
                    <strong>⚠ Unable to fetch URL</strong><br><br>
                    Could not fetch <code>${escapeHtml(url)}</code>.<br><br>
                    ${escapeHtml(fetchErr.message)}<br><br>
                    <strong>Workaround:</strong> Open the page in your browser, press
                    <kbd>Ctrl+U</kbd> (or <kbd>Cmd+U</kbd>) to view source, copy all the HTML,
                    then paste it into the <strong>"Paste HTML"</strong> tab.
                </div>`;
            btn.disabled = false;
            return;
        }

        showLoading(resultsDiv, 'Analysing accessibility…');
        const checker = new AccessibilityChecker();
        const report = checker.check(html);
        const score   = calculateScore(report);

        // ── Auto-save to backend ──
        const saved = await API.saveAudit({
            url,
            score,
            critical: report.summary.critical,
            serious:  report.summary.serious,
            moderate: report.summary.moderate,
            passed:   report.summary.passed,
            issues:   report.issues,
            source:   'url'
        });

        // ── Fetch history for this URL ──
        const historyData = await API.getHistory(url);
        const historyBanner = historyData && historyData.count > 1
            ? renderHistoryBanner(historyData.history, url)
            : '';

        const backendBadge = saved
            ? `<span style="font-size:0.75rem;background:rgba(0,200,150,0.1);color:var(--accent);padding:2px 8px;border-radius:3px;margin-left:8px;">✓ Saved to history</span>`
            : '';

        sourceBanner = `<div class="warn-box" style="background:rgba(0,200,150,0.06);border-color:rgba(0,200,150,0.25);color:var(--accent);">
            ✓ Live HTML fetched from <strong>${escapeHtml(url)}</strong>${backendBadge}
        </div>${historyBanner}`;

        displayResults(report, resultsDiv, sourceBanner);
        btn.disabled = false;
    });

    // ── Check HTML ──
    document.getElementById('checkHtmlBtn').addEventListener('click', async () => {
        const html = document.getElementById('htmlInput').value.trim();
        if (!html) { alert('Please paste some HTML code'); return; }

        const resultsDiv = document.getElementById('results');
        showLoading(resultsDiv, 'Analysing…');
        const checker = new AccessibilityChecker();
        const report = checker.check(html);
        const score  = calculateScore(report);

        // Save pasted HTML audits too (no URL)
        await API.saveAudit({
            url: null,
            label: 'Pasted HTML',
            score,
            critical: report.summary.critical,
            serious:  report.summary.serious,
            moderate: report.summary.moderate,
            passed:   report.summary.passed,
            issues:   report.issues,
            source:   'paste'
        });

        displayResults(report, resultsDiv, null);
    });

    // ── Compare ──
    document.getElementById('fetchSiteA').addEventListener('click', () =>
        fetchSiteForComparison('siteA', document.getElementById('compareUrlA').value.trim()));

    document.getElementById('fetchSiteB').addEventListener('click', () =>
        fetchSiteForComparison('siteB', document.getElementById('compareUrlB').value.trim()));

    document.getElementById('compareBtn').addEventListener('click', compareSites);

    // ── Statistics ──
    document.getElementById('loadStatistics').addEventListener('click', loadStatistics);
});