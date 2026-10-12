// Skill / technology dictionary used for keyword gap analysis (JD vs resume) and for tagging
// recruiter emails with a field. Each entry: [canonical name, regex (case-insensitive), category].
// Keep regexes word-bounded so "Go" or "C" do not match everything.

const T = (name, rx, cat) => ({ name, rx: new RegExp(rx, "i"), cat });
const w = (s) => `(?<![A-Za-z0-9])${s}(?![A-Za-z0-9])`;

export const SKILLS = [
  // --- Windows / infrastructure
  T("Windows Server", w("windows server(?: 20\\d\\d(?: r2)?)?"), "infra"),
  T("Active Directory", w("active directory|AD DS|ADDS"), "infra"),
  T("Group Policy", w("group policy|GPO"), "infra"),
  T("DNS", w("DNS"), "infra"), T("DHCP", w("DHCP"), "infra"),
  T("PowerShell", w("powershell"), "infra"),
  T("WSUS", w("WSUS"), "infra"), T("SCCM", w("SCCM|MECM|Configuration Manager|Endpoint Configuration Manager"), "infra"),
  T("Intune", w("intune"), "infra"), T("Autopilot", w("autopilot"), "infra"),
  T("Microsoft 365", w("microsoft 365|M365|office 365|O365"), "infra"),
  T("Exchange", w("exchange(?: server| online)?"), "infra"),
  T("Entra ID / Azure AD", w("entra id|azure ad|azure active directory"), "infra"),
  T("Hyper-V", w("hyper-?v"), "infra"), T("VMware", w("vmware|vsphere|esxi|vcenter"), "infra"),
  T("Citrix", w("citrix|xenapp|xendesktop"), "infra"), T("Nutanix", w("nutanix"), "infra"),
  T("SAN/NAS storage", w("SAN|NAS|iSCSI|fibre channel|netapp|pure storage|compellent"), "infra"),
  T("Failover clustering", w("failover cluster(?:ing)?|WSFC|load balanc(?:ing|er)"), "infra"),
  T("Backup (Veeam)", w("veeam"), "infra"), T("Backup Exec", w("backup exec"), "infra"),
  T("Arcserve", w("arcserve"), "infra"), T("CommVault", w("commvault"), "infra"),
  T("Disaster recovery", w("disaster recovery|DR plan|business continuity"), "infra"),
  T("RDS / Terminal Services", w("remote desktop services|RDS|terminal services"), "infra"),
  T("IIS", w("IIS"), "infra"), T("SQL Server", w("SQL server|MSSQL"), "infra"),
  T("SharePoint", w("sharepoint"), "infra"), T("Teams", w("microsoft teams"), "infra"),
  T("PKI / certificates", w("PKI|certificate services|SSL/?TLS|certificates?"), "infra"),
  T("Patch management", w("patch(?:ing| management)"), "infra"),
  T("ServiceNow", w("servicenow"), "itsm"), T("ITIL", w("ITIL"), "itsm"),
  T("Jira", w("jira"), "itsm"), T("Confluence", w("confluence"), "itsm"),
  T("Change management", w("change management|CAB|change advisory"), "itsm"),
  T("Release management", w("release management|release manager"), "itsm"),
  T("Incident management", w("incident management"), "itsm"),
  T("Linux", w("linux|RHEL|red hat|ubuntu|centos"), "infra"), T("Unix", w("unix|solaris|AIX"), "infra"),
  T("Mainframe", w("mainframe|z/OS|COBOL|CICS"), "infra"),
  T("Monitoring (SolarWinds/PRTG/SCOM)", w("solarwinds|PRTG|nagios|SCOM|zabbix|datadog|whatsup gold"), "infra"),
  // --- Networking
  T("TCP/IP", w("TCP/?IP"), "network"), T("VLAN", w("VLANs?"), "network"), T("VPN", w("VPN"), "network"),
  T("Routing/switching", w("routers?|switch(?:es|ing)|OSPF|BGP|EIGRP"), "network"),
  T("Firewalls", w("firewalls?"), "network"), T("Cisco", w("cisco"), "network"),
  T("Palo Alto", w("palo alto"), "network"), T("Fortinet", w("fortinet|fortigate"), "network"),
  T("Meraki", w("meraki"), "network"), T("Aruba", w("aruba"), "network"), T("Juniper", w("juniper"), "network"),
  T("Wireless", w("wireless|wi-?fi|WLAN"), "network"), T("LAN/WAN", w("LAN/?WAN|WAN|LAN"), "network"),
  T("SD-WAN", w("SD-?WAN"), "network"), T("Load balancer (F5)", w("F5|load balancer"), "network"),
  T("CCNA", w("CCNA"), "cert"), T("CCNP", w("CCNP"), "cert"), T("Network+", w("network\\+"), "cert"),
  // --- Cloud
  T("AWS", w("AWS|amazon web services"), "cloud"), T("Azure", w("azure"), "cloud"),
  T("GCP", w("GCP|google cloud"), "cloud"), T("EC2", w("EC2"), "cloud"), T("S3", w("S3"), "cloud"),
  T("Lambda", w("lambda"), "cloud"), T("CloudFormation", w("cloudformation"), "cloud"),
  T("Terraform", w("terraform"), "devops"), T("Ansible", w("ansible"), "devops"),
  T("Docker", w("docker|containers?"), "devops"), T("Kubernetes", w("kubernetes|k8s|EKS|AKS|GKE"), "devops"),
  T("CI/CD", w("CI/?CD|continuous integration|continuous delivery"), "devops"),
  T("Jenkins", w("jenkins"), "devops"), T("Git", w("git|github|gitlab|bitbucket"), "devops"),
  T("Azure DevOps", w("azure devops|ADO"), "devops"),
  T("AWS Solutions Architect", w("solutions architect"), "cert"), T("AZ-104", w("AZ-?104"), "cert"),
  T("AZ-900", w("AZ-?900"), "cert"), T("AWS Cloud Practitioner", w("cloud practitioner"), "cert"),
  // --- Security / SOC
  T("SIEM", w("SIEM"), "security"), T("Splunk", w("splunk"), "security"),
  T("Microsoft Sentinel", w("sentinel"), "security"), T("QRadar", w("qradar"), "security"),
  T("EDR (CrowdStrike/Defender)", w("EDR|crowdstrike|defender for endpoint|carbon black|sentinelone"), "security"),
  T("Incident response", w("incident response"), "security"), T("Threat hunting", w("threat hunting"), "security"),
  T("Vulnerability management", w("vulnerability (?:management|assessment|scanning)|nessus|qualys|tenable"), "security"),
  T("MITRE ATT&CK", w("MITRE(?: ATT&CK)?"), "security"), T("NIST", w("NIST"), "security"),
  T("ISO 27001", w("ISO ?27001"), "security"), T("SOC 2", w("SOC ?2"), "security"),
  T("HIPAA", w("HIPAA"), "security"), T("PCI DSS", w("PCI(?:[- ]DSS)?"), "security"),
  T("Phishing analysis", w("phishing"), "security"), T("IDS/IPS", w("IDS/?IPS|snort|suricata"), "security"),
  T("Security+", w("security\\+"), "cert"), T("CISSP", w("CISSP"), "cert"), T("CEH", w("CEH"), "cert"),
  T("CySA+", w("CySA\\+"), "cert"), T("GIAC", w("GIAC|GSEC|GCIH"), "cert"),
  T("Zero trust", w("zero trust"), "security"), T("MFA", w("MFA|multi-?factor"), "security"),
  T("IAM", w("IAM|identity and access management"), "security"), T("Okta", w("okta"), "security"),
  T("CyberArk", w("cyberark"), "security"), T("DLP", w("DLP|data loss prevention"), "security"),
  // --- Development / data
  T("Python", w("python"), "dev"), T("Java", w("java(?!script)"), "dev"), T("JavaScript", w("javascript|node\\.?js"), "dev"),
  T("TypeScript", w("typescript"), "dev"), T("C#/.NET", w("C#|\\.NET|dotnet"), "dev"), T("SQL", w("SQL"), "dev"),
  T("Bash", w("bash|shell scripting"), "dev"), T("REST APIs", w("REST(?:ful)?(?: APIs?)?"), "dev"),
  T("React", w("react"), "dev"), T("Angular", w("angular"), "dev"),
  T("Salesforce", w("salesforce"), "dev"), T("SAP", w("SAP"), "dev"), T("Oracle", w("oracle"), "dev"),
  T("Power BI", w("power ?bi"), "data"), T("Tableau", w("tableau"), "data"), T("Excel", w("excel"), "data"),
  T("ETL", w("ETL"), "data"), T("Snowflake", w("snowflake"), "data"), T("Databricks", w("databricks"), "data"),
  // --- PM / methodology / certs
  T("Agile/Scrum", w("agile|scrum"), "pm"), T("SDLC", w("SDLC"), "pm"), T("PMP", w("PMP"), "cert"),
  T("Six Sigma", w("six sigma"), "pm"), T("Visio", w("visio"), "pm"), T("MS Project", w("ms project|microsoft project"), "pm"),
  // --- Help desk / end user
  T("Help desk / Tier 1-3", w("help ?desk|service desk|tier ?[123]|L[123] support"), "support"),
  T("Windows 10/11", w("windows 1[01]"), "support"), T("macOS", w("mac ?os|macbook"), "support"),
  T("Imaging/deployment (MDT/WDS)", w("MDT|WDS|imaging"), "support"),
  T("Printers/peripherals", w("printers?"), "support"), T("Remote support", w("remote support|RDP|TeamViewer"), "support"),
  // --- Civil / construction engineering (CCPromoters core market)
  T("AutoCAD", w("autocad"), "civil"), T("Civil 3D", w("civil ?3d"), "civil"), T("Revit", w("revit"), "civil"),
  T("MicroStation", w("microstation"), "civil"), T("OpenRoads", w("openroads"), "civil"),
  T("HEC-RAS / HEC-HMS", w("HEC-?(?:RAS|HMS)"), "civil"), T("Stormwater", w("storm ?water|drainage"), "civil"),
  T("Site development", w("site development|site design|grading"), "civil"),
  T("Structural analysis", w("structural (?:analysis|design)|STAAD|ETABS|SAP2000|RISA"), "civil"),
  T("Transportation / roadway", w("roadway|highway|transportation design|traffic"), "civil"),
  T("Geotechnical", w("geotechnical"), "civil"), T("Water/wastewater", w("wastewater|water resources|utilities"), "civil"),
  T("Construction management", w("construction management|CM services|construction inspection"), "civil"),
  T("Bluebeam", w("bluebeam"), "civil"), T("Primavera P6", w("primavera|P6"), "civil"), T("Procore", w("procore"), "civil"),
  T("PE license", w("PE(?: license)?|professional engineer"), "cert"), T("EIT/FE", w("EIT|FE exam|engineer in training"), "cert"),
  T("LEED", w("LEED"), "cert"), T("OSHA", w("OSHA"), "cert"),
  T("Estimating / quantity takeoff", w("estimating|quantity take-?off"), "civil"),
  T("Land development", w("land development|subdivision"), "civil"),
];

/** Return the dictionary entries whose regex matches the text. */
export function findSkills(text) {
  if (!text) return [];
  return SKILLS.filter((s) => s.rx.test(text));
}

/** Skills in the JD that the resume does not mention (by dictionary regex). */
export function keywordGap(jdText, resumeText) {
  const inJd = findSkills(jdText);
  const have = new Set(findSkills(resumeText).map((s) => s.name));
  return {
    matched: inJd.filter((s) => have.has(s.name)).map((s) => s.name),
    missing: inJd.filter((s) => !have.has(s.name)).map((s) => s.name),
  };
}

/** Years of experience requested by a JD, if stated ("5+ years", "minimum of 7 years"). */
export function yearsRequired(jdText) {
  if (!jdText) return null;
  const rx = /(?:minimum(?: of)?|at least|over|more than|)\s*(\d{1,2})\s*(?:\+|or more|to \d{1,2}|-\s*\d{1,2})?\s*(?:\+\s*)?(?:years?|yrs?)(?:'|\b)/gi;
  let best = null;
  let m;
  while ((m = rx.exec(jdText))) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 30 && (best === null || n > best)) best = n;
  }
  return best;
}

/** Guess the professional field of a text from the dictionary categories (for recruiter mail tags). */
export function fieldTags(text) {
  const counts = {};
  for (const s of findSkills(text)) counts[s.cat] = (counts[s.cat] || 0) + 1;
  const labels = {
    infra: "Windows / Infrastructure", network: "Networking", cloud: "Cloud", devops: "DevOps",
    security: "Cybersecurity / SOC", dev: "Development", data: "Data / BI", itsm: "ITSM / Release",
    pm: "Project Management", support: "IT Support", civil: "Civil Engineering", cert: "Certifications",
  };
  return Object.entries(counts)
    .filter(([cat]) => cat !== "cert")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cat]) => labels[cat]);
}
