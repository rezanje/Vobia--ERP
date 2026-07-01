import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  Factory,
  FileSpreadsheet,
  Filter,
  LayoutDashboard,
  LineChart,
  PackageCheck,
  Search,
  Settings,
  Shirt,
  Upload,
  Users,
  X,
} from 'lucide-react';
import './styles.css';

const productionRows = [
  {
    id: 'PO-2406-018',
    sku: 'VB-MIRA-BLK',
    name: 'Mira Pleated Top',
    collection: 'Daily Muse',
    vendor: 'CV Lestari Jahit',
    qty: 680,
    status: 'Delayed',
    progress: 72,
    deadline: '18 Jun',
    qc: 'Belum QC',
    issue: 'Standar jahit lipit belum konsisten',
  },
  {
    id: 'PO-2406-021',
    sku: 'VB-ARA-CRM',
    name: 'Ara Linen Shirt',
    collection: 'Core Basics',
    vendor: 'Rumah Jahit Nara',
    qty: 920,
    status: 'In Progress',
    progress: 58,
    deadline: '22 Jun',
    qc: 'Sampling OK',
    issue: 'Menunggu tambahan kancing',
  },
  {
    id: 'PO-2406-014',
    sku: 'VB-NAYA-NVY',
    name: 'Naya Wide Pants',
    collection: 'Office Edit',
    vendor: 'PT Benang Rapi',
    qty: 540,
    status: 'QC',
    progress: 91,
    deadline: '17 Jun',
    qc: 'Reject 4.2%',
    issue: 'Benang sisa perlu dirapikan',
  },
  {
    id: 'PO-2406-011',
    sku: 'VB-SORA-WHT',
    name: 'Sora Collar Dress',
    collection: 'Summer Drop',
    vendor: 'Studio Jahit Elma',
    qty: 430,
    status: 'Ready',
    progress: 100,
    deadline: '15 Jun',
    qc: 'Passed',
    issue: 'Siap distribusi',
  },
  {
    id: 'PO-2406-025',
    sku: 'VB-KAYA-OLV',
    name: 'Kaya Utility Skirt',
    collection: 'Urban Field',
    vendor: 'CV Lestari Jahit',
    qty: 760,
    status: 'Material Ready',
    progress: 18,
    deadline: '27 Jun',
    qc: 'Belum QC',
    issue: 'Produksi mulai besok',
  },
];

const inventoryRows = [
  { sku: 'VB-SORA-WHT', name: 'Sora Collar Dress', stock: 146, sold: 522, days: 8, turnover: 3.6, flag: 'Fast' },
  { sku: 'VB-MIRA-BLK', name: 'Mira Pleated Top', stock: 88, sold: 436, days: 6, turnover: 4.9, flag: 'Fast' },
  { sku: 'VB-NAYA-NVY', name: 'Naya Wide Pants', stock: 392, sold: 128, days: 28, turnover: 1.1, flag: 'Normal' },
  { sku: 'VB-LUNA-GLD', name: 'Luna Satin Skirt', stock: 814, sold: 74, days: 66, turnover: 0.4, flag: 'Slow' },
  { sku: 'VB-ELIO-GRN', name: 'Elio Boxy Tee', stock: 690, sold: 91, days: 52, turnover: 0.5, flag: 'Slow' },
];

const vendors = [
  { name: 'CV Lestari Jahit', batches: 12, onTime: 74, reject: 5.8 },
  { name: 'Rumah Jahit Nara', batches: 8, onTime: 88, reject: 2.1 },
  { name: 'PT Benang Rapi', batches: 10, onTime: 81, reject: 3.4 },
  { name: 'Studio Jahit Elma', batches: 6, onTime: 94, reject: 1.7 },
];

const nav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'production', label: 'Produksi', icon: Factory },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function App() {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [range, setRange] = useState('7 hari');
  const [status, setStatus] = useState('Semua Status');
  const [selectedRow, setSelectedRow] = useState(productionRows[0]);
  const [showImport, setShowImport] = useState(false);
  const [reportTab, setReportTab] = useState('production');

  const filteredProduction = useMemo(() => {
    if (status === 'Semua Status') return productionRows;
    return productionRows.filter((row) => row.status === status);
  }, [status]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <div className="brand-title">VOBIA</div>
            <div className="brand-subtitle">Control Tower</div>
          </div>
        </div>

        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${activeNav === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => setActiveNav(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <div className="eyebrow">Data freshness</div>
          <strong>11 Jun 2026, 14:43</strong>
          <span>Spreadsheet, Jubelio, Accurate synced by CSV import.</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Operations Command Center</div>
            <h1>Dashboard operasional harian</h1>
          </div>
          <div className="top-actions">
            <div className="searchbox">
              <Search size={17} />
              <input aria-label="Cari SKU atau vendor" placeholder="Cari SKU, vendor, batch..." />
            </div>
            <button className="icon-btn" title="Export report">
              <Download size={18} />
            </button>
            <button className="primary-btn" onClick={() => setShowImport(true)}>
              <Upload size={18} />
              Import CSV
            </button>
          </div>
        </header>

        <section className="filters">
          <Filter size={18} />
          <SelectButton value={range} onChange={setRange} options={['7 hari', '30 hari', 'Quarter ini']} />
          <SelectButton
            value={status}
            onChange={setStatus}
            options={['Semua Status', 'Delayed', 'In Progress', 'QC', 'Ready', 'Material Ready']}
          />
          <SelectButton value="Semua Vendor" options={['Semua Vendor', ...vendors.map((vendor) => vendor.name)]} />
          <SelectButton value="Semua Collection" options={['Semua Collection', 'Daily Muse', 'Core Basics', 'Summer Drop']} />
        </section>

        <section className="kpi-grid">
          <Metric icon={ClipboardList} label="Active projects" value="38" delta="+6 minggu ini" tone="neutral" />
          <Metric icon={AlertTriangle} label="Overdue production" value="7" delta="3 high risk" tone="danger" />
          <Metric icon={PackageCheck} label="Ready stock" value="12.486" delta="SKU coverage 82%" tone="good" />
          <Metric icon={LineChart} label="Fast-moving SKU" value="14" delta="5 perlu restock" tone="accent" />
        </section>

        <section className="content-grid">
          <div className="work-surface large">
            <div className="section-head">
              <div>
                <h2>Production Risk Monitor</h2>
                <p>Batch produksi yang butuh perhatian ops hari ini.</p>
              </div>
              <button className="ghost-btn">Lihat semua</button>
            </div>

            <div className="table production-table">
              <div className="table-row table-head">
                <span>Batch</span>
                <span>Produk</span>
                <span>Vendor</span>
                <span>Status</span>
                <span>Progress</span>
                <span>Deadline</span>
              </div>
              {filteredProduction.map((row) => (
                <button className="table-row clickable" key={row.id} onClick={() => setSelectedRow(row)}>
                  <span>
                    <strong>{row.id}</strong>
                    <small>{row.sku}</small>
                  </span>
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.collection}</small>
                  </span>
                  <span>{row.vendor}</span>
                  <span>
                    <StatusPill status={row.status} />
                  </span>
                  <span>
                    <Progress value={row.progress} status={row.status} />
                  </span>
                  <span>{row.deadline}</span>
                </button>
              ))}
            </div>
          </div>

          <aside className="right-panel">
            <div className="work-surface detail-panel">
              <div className="section-head compact">
                <div>
                  <h2>Batch detail</h2>
                  <p>{selectedRow.id}</p>
                </div>
                <StatusPill status={selectedRow.status} />
              </div>
              <div className="detail-stack">
                <Detail label="Produk" value={`${selectedRow.name} (${selectedRow.sku})`} />
                <Detail label="Vendor" value={selectedRow.vendor} />
                <Detail label="Qty" value={`${selectedRow.qty.toLocaleString('id-ID')} pcs`} />
                <Detail label="QC" value={selectedRow.qc} />
                <Detail label="Issue" value={selectedRow.issue} />
              </div>
              <div className="action-row">
                <button className="secondary-btn">Update status</button>
                <button className="ghost-btn">Tambah note</button>
              </div>
            </div>

            <div className="work-surface">
              <div className="section-head compact">
                <div>
                  <h2>Vendor performance</h2>
                  <p>On-time dan reject rate</p>
                </div>
              </div>
              <div className="vendor-list">
                {vendors.map((vendor) => (
                  <div className="vendor-row" key={vendor.name}>
                    <div>
                      <strong>{vendor.name}</strong>
                      <small>{vendor.batches} batch aktif</small>
                    </div>
                    <div className="vendor-metric">
                      <span>{vendor.onTime}%</span>
                      <small>{vendor.reject}% reject</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>

        <section className="bottom-grid">
          <div className="work-surface">
            <div className="section-head">
              <div>
                <h2>Inventory Turnover</h2>
                <p>SKU lambat dan cepat bergerak.</p>
              </div>
              <button className="ghost-btn">Export XLSX</button>
            </div>
            <div className="inventory-list">
              {inventoryRows.map((item) => (
                <div className="inventory-row" key={item.sku}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.sku}</small>
                  </div>
                  <span>{item.stock} stok</span>
                  <span>{item.sold} sold</span>
                  <span>{item.days} days</span>
                  <Flag flag={item.flag} />
                </div>
              ))}
            </div>
          </div>

          <div className="work-surface">
            <div className="section-head">
              <div>
                <h2>Report Center</h2>
                <p>Report prioritas untuk meeting operasional.</p>
              </div>
            </div>
            <div className="tabs">
              {[
                ['production', 'Production'],
                ['inventory', 'Inventory'],
                ['merch', 'Merchandising'],
              ].map(([id, label]) => (
                <button className={reportTab === id ? 'active' : ''} key={id} onClick={() => setReportTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            <ReportPreview tab={reportTab} />
          </div>
        </section>
      </main>

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function SelectButton({ value, onChange, options = [] }) {
  return (
    <div className="select-wrap">
      <select value={value} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <ChevronDown size={16} />
    </div>
  );
}

function Metric({ icon: Icon, label, value, delta, tone }) {
  return (
    <div className={`metric ${tone}`}>
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{delta}</small>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const key = status.toLowerCase().replace(/\s/g, '-');
  return <span className={`status-pill ${key}`}>{status}</span>;
}

function Progress({ value, status }) {
  return (
    <div className="progress-wrap">
      <div className="progress-track">
        <div className={`progress-bar ${status === 'Delayed' ? 'danger' : ''}`} style={{ width: `${value}%` }} />
      </div>
      <small>{value}%</small>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Flag({ flag }) {
  return <span className={`flag ${flag.toLowerCase()}`}>{flag}</span>;
}

function ReportPreview({ tab }) {
  const copy = {
    production: ['7 overdue batch', '3 vendor perlu follow-up', 'Avg delay 2.8 hari'],
    inventory: ['2 slow-moving SKU kritis', '5 SKU perlu restock', 'Coverage ready stock 82%'],
    merch: ['Core Basics sell-through 64%', 'Summer Drop margin sehat', 'Daily Muse risk bahan baku'],
  };

  return (
    <div className="report-preview">
      {copy[tab].map((item, index) => (
        <div className="report-line" key={item}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong>{item}</strong>
          {index === 0 ? <CheckCircle2 size={17} /> : <CalendarDays size={17} />}
        </div>
      ))}
    </div>
  );
}

function ImportModal({ onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2>Import data operasional</h2>
            <p>Upload export Spreadsheet, Jubelio, atau Accurate untuk update dashboard.</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="Tutup modal">
            <X size={18} />
          </button>
        </div>
        <div className="upload-zone">
          <FileSpreadsheet size={34} />
          <strong>Drop CSV/XLSX di sini</strong>
          <span>Prototype demo: klik import untuk simulasi validasi.</span>
        </div>
        <div className="mapping-grid">
          <Detail label="Rows created" value="128" />
          <Detail label="Rows updated" value="42" />
          <Detail label="Rows skipped" value="3" />
          <Detail label="Validation errors" value="SKU tidak dikenal: 3" />
        </div>
        <div className="action-row right">
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" onClick={onClose}>
            <Upload size={18} />
            Simulasi import
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
