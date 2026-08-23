(function () {
  'use strict';

  var REC_KEY = 'alba_records_v1';
  var SET_KEY = 'alba_settings_v1';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  // ---------- storage ----------
  function loadRecords() {
    try { return JSON.parse(localStorage.getItem(REC_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveRecords(r) { localStorage.setItem(REC_KEY, JSON.stringify(r)); }

  function loadSettings() {
    var defaults = { hourlyWage: 10320, name: '', weekStart: 1 };
    try {
      var s = JSON.parse(localStorage.getItem(SET_KEY));
      return Object.assign(defaults, s || {});
    } catch (e) { return defaults; }
  }
  function saveSettings(s) { localStorage.setItem(SET_KEY, JSON.stringify(s)); }

  var records = loadRecords();
  var settings = loadSettings();

  var today = new Date();
  var viewYear = today.getFullYear();
  var viewMonth = today.getMonth(); // 0-indexed

  // ---------- date helpers ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) {
    var parts = s.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }

  function timeToMinutes(t) {
    var parts = t.split(':').map(Number);
    return parts[0] * 60 + parts[1];
  }

  function calcWorkedMinutes(rec) {
    var s = timeToMinutes(rec.start);
    var e = timeToMinutes(rec.end);
    if (e < s) e += 24 * 60; // overnight shift
    return Math.max(0, e - s - (Number(rec.breakMinutes) || 0));
  }

  function calcDailyPay(rec, wage) {
    var hours = calcWorkedMinutes(rec) / 60;
    return Math.round(hours * wage);
  }

  // ---------- week grouping & 주휴수당 ----------
  function getWeekStartDate(dateObj) {
    var day = dateObj.getDay();
    var ws = settings.weekStart;
    var diff = (day - ws + 7) % 7;
    return addDays(dateObj, -diff);
  }

  function computeWeeklyPays() {
    var weeks = {};
    Object.keys(records).forEach(function (dateStr) {
      var d = parseDate(dateStr);
      var wsDate = getWeekStartDate(d);
      var key = fmtDate(wsDate);
      if (!weeks[key]) weeks[key] = { start: wsDate, totalMinutes: 0 };
      weeks[key].totalMinutes += calcWorkedMinutes(records[dateStr]);
    });
    return Object.keys(weeks).map(function (key) {
      var w = weeks[key];
      var hours = w.totalMinutes / 60;
      var end = addDays(w.start, 6);
      var eligible = hours >= 15;
      var pay = eligible ? Math.round(Math.min(hours, 40) / 40 * 8 * settings.hourlyWage) : 0;
      return { start: w.start, end: end, hours: hours, eligible: eligible, pay: pay };
    });
  }

  // ---------- payslip ----------
  function buildPayslip(year, month) {
    var wage = settings.hourlyWage;
    var monthStr = year + '-' + pad(month + 1);

    var dayItems = Object.keys(records)
      .filter(function (dateStr) { return dateStr.indexOf(monthStr) === 0; })
      .sort()
      .map(function (dateStr) {
        var rec = records[dateStr];
        var minutes = calcWorkedMinutes(rec);
        var pay = calcDailyPay(rec, wage);
        return { type: 'day', date: dateStr, rec: rec, minutes: minutes, pay: pay };
      });

    var weekItems = computeWeeklyPays()
      .filter(function (w) { return w.eligible && w.end.getFullYear() === year && w.end.getMonth() === month; })
      .map(function (w) { return { type: 'week', date: fmtDate(w.end), week: w }; });

    var items = dayItems.concat(weekItems).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    var totalMinutes = dayItems.reduce(function (s, i) { return s + i.minutes; }, 0);
    var basePay = dayItems.reduce(function (s, i) { return s + i.pay; }, 0);
    var weeklyPayTotal = weekItems.reduce(function (s, i) { return s + i.week.pay; }, 0);

    return {
      items: items,
      dayCount: dayItems.length,
      totalHours: totalMinutes / 60,
      basePay: basePay,
      weeklyPayTotal: weeklyPayTotal,
      totalPay: basePay + weeklyPayTotal
    };
  }

  // ---------- formatting ----------
  function money(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- rendering ----------
  function renderMonthLabels() {
    var label = viewYear + '년 ' + (viewMonth + 1) + '월';
    document.getElementById('entryMonthLabel').textContent = label;
    document.getElementById('payslipMonthLabel').textContent = label;
  }

  function renderRecordList() {
    var monthStr = viewYear + '-' + pad(viewMonth + 1);
    var dates = Object.keys(records).filter(function (d) { return d.indexOf(monthStr) === 0; }).sort();
    var container = document.getElementById('recordList');
    if (dates.length === 0) {
      container.innerHTML = '<p class="empty">이번 달 기록이 없습니다.</p>';
      return;
    }
    container.innerHTML = dates.map(function (dateStr) {
      var rec = records[dateStr];
      var d = parseDate(dateStr);
      var pay = calcDailyPay(rec, settings.hourlyWage);
      return '' +
        '<div class="record-item" data-date="' + dateStr + '">' +
          '<div class="record-main">' +
            '<span class="record-date">' + (d.getMonth() + 1) + '/' + d.getDate() + '(' + DOW[d.getDay()] + ')</span>' +
            '<span class="record-time">' + rec.start + '~' + rec.end + ' (휴게 ' + (rec.breakMinutes || 0) + '분)</span>' +
          '</div>' +
          '<div class="record-side">' +
            '<span class="record-pay">' + money(pay) + '</span>' +
            '<button type="button" class="icon-btn edit-btn" data-date="' + dateStr + '">수정</button>' +
            '<button type="button" class="icon-btn delete-btn" data-date="' + dateStr + '">삭제</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function renderPayslip() {
    var ps = buildPayslip(viewYear, viewMonth);
    var container = document.getElementById('payslip');
    var lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();

    var headerHtml = '' +
      '<div class="payslip-header">' +
        '<h2>급여명세서</h2>' +
        '<p>지급대상기간: ' + viewYear + '년 ' + (viewMonth + 1) + '월 1일 ~ ' + viewYear + '년 ' + (viewMonth + 1) + '월 ' + lastDay + '일</p>' +
        (settings.name ? '<p>이름 / 사업장: ' + escapeHtml(settings.name) + '</p>' : '') +
        '<p>시급: ' + money(settings.hourlyWage) + '</p>' +
      '</div>';

    if (ps.items.length === 0) {
      container.innerHTML = headerHtml + '<p class="empty">이 달에는 근무 기록이 없습니다.</p>';
      return;
    }

    var rows = ps.items.map(function (item) {
      if (item.type === 'day') {
        var d = parseDate(item.date);
        return '<tr>' +
          '<td>' + (d.getMonth() + 1) + '/' + d.getDate() + '</td>' +
          '<td>' + DOW[d.getDay()] + '</td>' +
          '<td>' + item.rec.start + '</td>' +
          '<td>' + item.rec.end + '</td>' +
          '<td>' + (item.rec.breakMinutes || 0) + '분</td>' +
          '<td>' + (item.minutes / 60).toFixed(1) + 'h</td>' +
          '<td>' + money(item.pay) + '</td>' +
        '</tr>';
      } else {
        var w = item.week, s = w.start, e = w.end;
        return '<tr class="week-row">' +
          '<td colspan="6">' + (s.getMonth() + 1) + '/' + s.getDate() + '(' + DOW[s.getDay()] + ')~' +
            (e.getMonth() + 1) + '/' + e.getDate() + '(' + DOW[e.getDay()] + ') 주휴수당 (근무 ' + w.hours.toFixed(1) + 'h)</td>' +
          '<td>' + money(w.pay) + '</td>' +
        '</tr>';
      }
    }).join('');

    container.innerHTML = headerHtml +
      '<div class="table-scroll"><table class="payslip-table">' +
        '<thead><tr><th>날짜</th><th>요일</th><th>출근</th><th>퇴근</th><th>휴게</th><th>근무시간</th><th>금액</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<div class="payslip-summary">' +
        '<div><span>총 근무일수</span><strong>' + ps.dayCount + '일</strong></div>' +
        '<div><span>총 근무시간</span><strong>' + ps.totalHours.toFixed(1) + '시간</strong></div>' +
        '<div><span>기본급</span><strong>' + money(ps.basePay) + '</strong></div>' +
        '<div><span>주휴수당</span><strong>' + money(ps.weeklyPayTotal) + '</strong></div>' +
        '<div class="total"><span>총 지급액</span><strong>' + money(ps.totalPay) + '</strong></div>' +
      '</div>' +
      '<p class="note">* 세금(소득세 등)이 공제되지 않은 세전 금액입니다. 주휴수당은 해당 주(週) 근무시간이 15시간 이상일 때, 결근이 없다고 가정하여 자동 계산됩니다.</p>';
  }

  function renderAll() {
    renderMonthLabels();
    renderRecordList();
    renderPayslip();
  }

  // ---------- form helpers ----------
  function resetForm() {
    document.getElementById('entryForm').reset();
    document.getElementById('workDate').value = fmtDate(new Date());
    document.getElementById('breakMinutes').value = 0;
    document.getElementById('editingDate').value = '';
    document.getElementById('cancelEditBtn').classList.add('hidden');
    document.getElementById('saveBtn').textContent = '저장';
    document.getElementById('formTitle').textContent = '근무 기록 입력';
  }

  function changeMonth(dir) {
    viewMonth += dir;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderAll();
  }

  // ---------- init ----------
  function init() {
    document.getElementById('hourlyWage').value = settings.hourlyWage;
    document.getElementById('userName').value = settings.name;
    document.getElementById('weekStart').value = settings.weekStart;
    document.getElementById('workDate').value = fmtDate(new Date());

    document.getElementById('hourlyWage').addEventListener('change', function (e) {
      settings.hourlyWage = Number(e.target.value) || 0;
      saveSettings(settings);
      renderAll();
    });
    document.getElementById('userName').addEventListener('change', function (e) {
      settings.name = e.target.value;
      saveSettings(settings);
      renderPayslip();
    });
    document.getElementById('weekStart').addEventListener('change', function (e) {
      settings.weekStart = Number(e.target.value);
      saveSettings(settings);
      renderAll();
    });
    document.getElementById('toggleAdvanced').addEventListener('click', function () {
      var panel = document.getElementById('advancedSettings');
      panel.classList.toggle('hidden');
      this.textContent = panel.classList.contains('hidden') ? '추가 설정 ▾' : '추가 설정 ▴';
    });

    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    document.getElementById('entryForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var dateStr = document.getElementById('workDate').value;
      var start = document.getElementById('startTime').value;
      var end = document.getElementById('endTime').value;
      var breakMinutes = Number(document.getElementById('breakMinutes').value) || 0;
      if (!dateStr || !start || !end) return;

      var editingDate = document.getElementById('editingDate').value;

      if (!editingDate && records[dateStr]) {
        if (!confirm(dateStr + '에 이미 기록이 있습니다. 덮어쓸까요?')) return;
      }
      if (editingDate && editingDate !== dateStr) {
        delete records[editingDate];
      }

      records[dateStr] = { start: start, end: end, breakMinutes: breakMinutes };
      saveRecords(records);

      var d = parseDate(dateStr);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();

      resetForm();
      renderAll();
    });

    document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

    document.getElementById('recordList').addEventListener('click', function (e) {
      var editBtn = e.target.closest('.edit-btn');
      var delBtn = e.target.closest('.delete-btn');
      if (editBtn) {
        var dateStr = editBtn.dataset.date;
        var rec = records[dateStr];
        document.getElementById('workDate').value = dateStr;
        document.getElementById('startTime').value = rec.start;
        document.getElementById('endTime').value = rec.end;
        document.getElementById('breakMinutes').value = rec.breakMinutes || 0;
        document.getElementById('editingDate').value = dateStr;
        document.getElementById('cancelEditBtn').classList.remove('hidden');
        document.getElementById('saveBtn').textContent = '수정 저장';
        document.getElementById('formTitle').textContent = '근무 기록 수정';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (delBtn) {
        var dd = delBtn.dataset.date;
        if (confirm(dd + ' 기록을 삭제할까요?')) {
          delete records[dd];
          saveRecords(records);
          renderAll();
        }
      }
    });

    document.getElementById('entryMonthNav').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-dir]');
      if (btn) changeMonth(Number(btn.dataset.dir));
    });
    document.getElementById('payslipMonthNav').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-dir]');
      if (btn) changeMonth(Number(btn.dataset.dir));
    });

    document.getElementById('printBtn').addEventListener('click', function () {
      document.querySelector('.tab-btn[data-tab="payslip"]').click();
      setTimeout(function () { window.print(); }, 100);
    });

    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
