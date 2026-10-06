"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

const api =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api/v1";
type Employee = {
  phone: string;
  roles: Array<{
    role: {
      name: string;
      permissions: Array<{ permission: { code: string } }>;
    };
  }>;
};
type Section = {
  id: string;
  label: string;
  group: string;
  permission: string;
  endpoint?: string;
};

const sections: Section[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    group: "Обзор",
    permission: "analytics.view",
    endpoint: "/staff/dashboard",
  },
  ...[
    ["customers", "Customers"],
    ["households", "Households"],
    ["members", "Members"],
  ].map(([id, label]) => ({
    id,
    label,
    group: "Клиенты",
    permission: "users.view",
  })),
  {
    id: "subscriptions",
    label: "Subscriptions",
    group: "Подписки и заказы",
    permission: "subscriptions.edit",
  },
  {
    id: "orders",
    label: "Orders and calendar",
    group: "Подписки и заказы",
    permission: "orders.edit",
  },
  ...[
    ["menus", "Menu"],
    ["meals", "Meals"],
    ["ingredients", "Ingredients"],
    ["allergens", "Allergens"],
    ["nutrition", "Nutrition Rules"],
  ].map(([id, label]) => ({
    id,
    label,
    group: "Питание",
    permission: "menu.edit",
  })),
  ...[
    ["kitchen", "Kitchen"],
    ["production", "Production"],
    ["packing", "Packing"],
    ["labels", "Labels"],
  ].map(([id, label]) => ({
    id,
    label,
    group: "Кухня",
    permission: "kitchen.manage",
  })),
  ...[
    ["inventory", "Inventory"],
    ["suppliers", "Suppliers"],
    ["purchases", "Purchases"],
    ["waste", "Waste"],
  ].map(([id, label]) => ({
    id,
    label,
    group: "Склад",
    permission: "inventory.manage",
  })),
  {
    id: "deliveries",
    label: "Deliveries",
    group: "Доставка",
    permission: "delivery.manage",
  },
  {
    id: "payments",
    label: "Payments",
    group: "Деньги",
    permission: "refund.manage",
  },
  {
    id: "refunds",
    label: "Refunds",
    group: "Деньги",
    permission: "refund.manage",
  },
  {
    id: "receipts",
    label: "Receipts",
    group: "Деньги",
    permission: "fiscalization.manage",
  },
  {
    id: "addons",
    label: "Add-ons",
    group: "Дополнения",
    permission: "menu.edit",
  },
  {
    id: "promocodes",
    label: "Promocodes",
    group: "Лояльность",
    permission: "promocodes.manage",
  },
  {
    id: "club",
    label: "JANTOK CLUB",
    group: "Лояльность",
    permission: "loyalty.manage",
  },
  {
    id: "bonuses",
    label: "Bonuses",
    group: "Лояльность",
    permission: "bonuses.adjust",
  },
  {
    id: "referrals",
    label: "Referrals",
    group: "Лояльность",
    permission: "loyalty.manage",
  },
  {
    id: "reviews",
    label: "Reviews",
    group: "Обратная связь",
    permission: "reviews.manage",
  },
  {
    id: "support",
    label: "Support",
    group: "Обратная связь",
    permission: "support.manage",
  },
  {
    id: "notifications",
    label: "Notifications",
    group: "Коммуникации",
    permission: "notifications.manage",
  },
  {
    id: "analytics",
    label: "Analytics",
    group: "Отчётность",
    permission: "analytics.view",
    endpoint: "/staff/analytics/summary",
  },
  {
    id: "exports",
    label: "Exports",
    group: "Отчётность",
    permission: "exports.create",
    endpoint: "/staff/analytics/exports",
  },
  {
    id: "employees",
    label: "Employees",
    group: "Управление",
    permission: "employees.manage",
  },
  {
    id: "roles",
    label: "Roles",
    group: "Управление",
    permission: "roles.manage",
  },
  {
    id: "permissions",
    label: "Permissions",
    group: "Управление",
    permission: "roles.manage",
  },
  {
    id: "audit",
    label: "Audit Logs",
    group: "Управление",
    permission: "audit.view",
  },
  {
    id: "settings",
    label: "System Settings",
    group: "Управление",
    permission: "settings.manage",
    endpoint: "/staff/settings",
  },
];

function short(value: unknown) {
  if (value === null || value === undefined) return "—";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

type UiLocale = "kk" | "ru" | "en";
const copy = {
  kk: {
    admin: "Операциялық панель",
    phone: "Телефон",
    getOtp: "OTP алу",
    code: "Код",
    login: "Кіру",
    refresh: "Жаңарту",
    realData: "● НАҚТЫ ДЕРЕКТЕР",
    newSetting: "Жаңа баптау нұсқасы",
    secretWarning: "Провайдер құпиялары мен кілттерін сервер қабылдамайды.",
    group: "Топ",
    key: "Кілт",
    status: "Мәртебе",
    reason: "Себеп",
    save: "Тексеру және сақтау",
    protectedExport: "Қорғалған экспорт",
    exportHint:
      "Сүзгілер, бірліктер, валюта және уақыт job пен файлда сақталады.",
    report: "Есеп",
    format: "Формат",
    create: "Қалыптастыру",
    search: "Ағымдағы тізімнен іздеу",
    rows: "жол",
    page: "бет",
    loading: "Сақталған деректер жүктелуде…",
    noData: "Ағымдағы сүзгілер бойынша дерек жоқ.",
    action: "Әрекет",
    block: "Бұғаттау",
    hide: "Жасыру",
    reply: "Жауап беру",
    details: "Толығырақ",
    back: "Артқа",
    next: "Келесі",
  },
  ru: {
    admin: "Операционная панель",
    phone: "Телефон",
    getOtp: "Получить OTP",
    code: "Код",
    login: "Войти",
    refresh: "Обновить",
    realData: "● РЕАЛЬНЫЕ ДАННЫЕ",
    newSetting: "Новая версия настройки",
    secretWarning: "Секреты и ключи провайдеров сервер отклоняет.",
    group: "Группа",
    key: "Ключ",
    status: "Статус",
    reason: "Причина",
    save: "Проверить и сохранить",
    protectedExport: "Защищённый экспорт",
    exportHint: "Фильтры, единицы, валюта и время сохраняются в job и файле.",
    report: "Отчёт",
    format: "Формат",
    create: "Сформировать",
    search: "Поиск в текущей выборке",
    rows: "строк",
    page: "стр.",
    loading: "Загрузка сохранённых данных…",
    noData: "По текущим фильтрам данных нет.",
    action: "Действие",
    block: "Блокировать",
    hide: "Скрыть",
    reply: "Ответить",
    details: "Детали",
    back: "Назад",
    next: "Далее",
  },
  en: {
    admin: "Operations panel",
    phone: "Phone",
    getOtp: "Get OTP",
    code: "Code",
    login: "Sign in",
    refresh: "Refresh",
    realData: "● REAL DATA",
    newSetting: "New settings version",
    secretWarning: "The server rejects provider secrets and private keys.",
    group: "Group",
    key: "Key",
    status: "Status",
    reason: "Reason",
    save: "Validate and save",
    protectedExport: "Protected export",
    exportHint:
      "Filters, units, currency and generation time are stored in the job and file.",
    report: "Report",
    format: "Format",
    create: "Generate",
    search: "Search current result",
    rows: "rows",
    page: "page",
    loading: "Loading persisted data…",
    noData: "No data matches the current filters.",
    action: "Action",
    block: "Block",
    hide: "Hide",
    reply: "Reply",
    details: "Details",
    back: "Back",
    next: "Next",
  },
} as const;

const groupCopy: Record<string, Record<UiLocale, string>> = {
  Обзор: { kk: "Шолу", ru: "Обзор", en: "Overview" },
  Клиенты: { kk: "Клиенттер", ru: "Клиенты", en: "Customers" },
  "Подписки и заказы": {
    kk: "Жазылымдар және тапсырыстар",
    ru: "Подписки и заказы",
    en: "Subscriptions and orders",
  },
  Питание: { kk: "Тамақтану", ru: "Питание", en: "Nutrition" },
  Кухня: { kk: "Ас үй", ru: "Кухня", en: "Kitchen" },
  Склад: { kk: "Қойма", ru: "Склад", en: "Inventory" },
  Доставка: { kk: "Жеткізу", ru: "Доставка", en: "Delivery" },
  Деньги: { kk: "Қаржы", ru: "Деньги", en: "Finance" },
  Дополнения: { kk: "Қосымшалар", ru: "Дополнения", en: "Add-ons" },
  Лояльность: { kk: "Адалдық", ru: "Лояльность", en: "Loyalty" },
  "Обратная связь": {
    kk: "Кері байланыс",
    ru: "Обратная связь",
    en: "Feedback",
  },
  Коммуникации: {
    kk: "Коммуникациялар",
    ru: "Коммуникации",
    en: "Communications",
  },
  Отчётность: { kk: "Есептілік", ru: "Отчётность", en: "Reporting" },
  Управление: { kk: "Басқару", ru: "Управление", en: "Management" },
};

const sectionCopy: Record<string, Record<UiLocale, string>> = {
  dashboard: { kk: "Бақылау тақтасы", ru: "Панель", en: "Dashboard" },
  customers: { kk: "Клиенттер", ru: "Клиенты", en: "Customers" },
  households: { kk: "Отбасылар", ru: "Домохозяйства", en: "Households" },
  members: { kk: "Қатысушылар", ru: "Участники", en: "Members" },
  subscriptions: { kk: "Жазылымдар", ru: "Подписки", en: "Subscriptions" },
  orders: {
    kk: "Тапсырыстар және күнтізбе",
    ru: "Заказы и календарь",
    en: "Orders and calendar",
  },
  menus: { kk: "Мәзір", ru: "Меню", en: "Menu" },
  meals: { kk: "Тағамдар", ru: "Блюда", en: "Meals" },
  ingredients: { kk: "Ингредиенттер", ru: "Ингредиенты", en: "Ingredients" },
  allergens: { kk: "Аллергендер", ru: "Аллергены", en: "Allergens" },
  nutrition: {
    kk: "Тамақтану ережелері",
    ru: "Правила питания",
    en: "Nutrition rules",
  },
  kitchen: { kk: "Ас үй", ru: "Кухня", en: "Kitchen" },
  production: { kk: "Өндіріс", ru: "Производство", en: "Production" },
  packing: { kk: "Жинақтау", ru: "Комплектация", en: "Packing" },
  labels: { kk: "Жапсырмалар", ru: "Этикетки", en: "Labels" },
  inventory: { kk: "Қойма", ru: "Склад", en: "Inventory" },
  suppliers: { kk: "Жеткізушілер", ru: "Поставщики", en: "Suppliers" },
  purchases: { kk: "Сатып алулар", ru: "Закупки", en: "Purchases" },
  waste: { kk: "Қалдықтар", ru: "Списания", en: "Waste" },
  deliveries: { kk: "Жеткізулер", ru: "Доставки", en: "Deliveries" },
  payments: { kk: "Төлемдер", ru: "Платежи", en: "Payments" },
  refunds: { kk: "Қайтарымдар", ru: "Возвраты", en: "Refunds" },
  receipts: { kk: "Түбіртектер", ru: "Чеки", en: "Receipts" },
  addons: { kk: "Қосымшалар", ru: "Дополнения", en: "Add-ons" },
  promocodes: { kk: "Промокодтар", ru: "Промокоды", en: "Promocodes" },
  club: { kk: "JANTOK CLUB", ru: "JANTOK CLUB", en: "JANTOK CLUB" },
  bonuses: { kk: "Бонустар", ru: "Бонусы", en: "Bonuses" },
  referrals: { kk: "Рефералдар", ru: "Рефералы", en: "Referrals" },
  reviews: { kk: "Пікірлер", ru: "Отзывы", en: "Reviews" },
  support: { kk: "Қолдау", ru: "Поддержка", en: "Support" },
  notifications: { kk: "Хабарландырулар", ru: "Уведомления", en: "Notifications" },
  analytics: { kk: "Аналитика", ru: "Аналитика", en: "Analytics" },
  exports: { kk: "Экспорт", ru: "Экспорт", en: "Exports" },
  employees: { kk: "Қызметкерлер", ru: "Сотрудники", en: "Employees" },
  roles: { kk: "Рөлдер", ru: "Роли", en: "Roles" },
  permissions: { kk: "Рұқсаттар", ru: "Права", en: "Permissions" },
  audit: { kk: "Аудит журналы", ru: "Журнал аудита", en: "Audit logs" },
  settings: {
    kk: "Жүйе баптаулары",
    ru: "Системные настройки",
    en: "System settings",
  },
};

const sectionLabel = (section: Section, locale: UiLocale) =>
  sectionCopy[section.id]?.[locale] ?? section.label;

const columnCopy: Record<string, Record<UiLocale, string>> = {
  phone: { kk: "Телефон", ru: "Телефон", en: "Phone" },
  firstName: { kk: "Аты", ru: "Имя", en: "First name" },
  lastName: { kk: "Тегі", ru: "Фамилия", en: "Last name" },
  status: { kk: "Күйі", ru: "Статус", en: "Status" },
  locale: { kk: "Тілі", ru: "Язык", en: "Language" },
  createdAt: { kk: "Құрылды", ru: "Создано", en: "Created" },
  updatedAt: { kk: "Жаңартылды", ru: "Обновлено", en: "Updated" },
  serviceDate: { kk: "Қызмет күні", ru: "Дата услуги", en: "Service date" },
  amountKzt: { kk: "Сома, ₸", ru: "Сумма, ₸", en: "Amount, ₸" },
  totalKzt: { kk: "Барлығы, ₸", ru: "Итого, ₸", en: "Total, ₸" },
  reason: { kk: "Себебі", ru: "Причина", en: "Reason" },
  generatedAt: { kk: "Жаңартылған", ru: "Обновлено", en: "Updated" },
  source: { kk: "Дерек көзі", ru: "Источник", en: "Source" },
  customers: { kk: "Клиенттер", ru: "Клиенты", en: "Customers" },
  activeSubscriptions: {
    kk: "Белсенді жазылымдар",
    ru: "Активные подписки",
    en: "Active subscriptions",
  },
  todayOrders: {
    kk: "Бүгінгі тапсырыстар",
    ru: "Заказы сегодня",
    en: "Today's orders",
  },
  openSupport: {
    kk: "Ашық өтініштер",
    ru: "Открытые обращения",
    en: "Open support",
  },
  paymentFailures: {
    kk: "Төлем қателері",
    ru: "Ошибки оплаты",
    en: "Payment failures",
  },
  lowStock: {
    kk: "Аз қалдық",
    ru: "Низкие остатки",
    en: "Low stock",
  },
};

const columnLabel = (column: string, locale: UiLocale) =>
  columnCopy[column]?.[locale] ??
  column
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());

const summaryValue = (key: string, value: unknown, locale: UiLocale) => {
  if (key === "source")
    return {
      kk: "Сақталған операциялық деректер",
      ru: "Сохранённые операционные данные",
      en: "Persisted operational data",
    }[locale];
  if (key === "generatedAt" && typeof value === "string")
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Almaty",
    }).format(new Date(value));
  return short(value);
};

export default function Home() {
  const [locale, setLocale] = useState<UiLocale>("kk");
  const [phone, setPhone] = useState("+77000000003");
  const [code, setCode] = useState("");
  const [accessToken, setAccessToken] = useState<string>();
  const [employee, setEmployee] = useState<Employee>();
  const [sectionId, setSectionId] = useState("dashboard");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown>>();
  const [selected, setSelected] = useState<Record<string, unknown>>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("");
  const [descending, setDescending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [settingGroup, setSettingGroup] = useState("CUTOFF");
  const [settingKey, setSettingKey] = useState("POLICY");
  const [settingStatus, setSettingStatus] = useState("DRAFT");
  const [settingReason, setSettingReason] = useState(
    "Проверенная версия бизнес-настройки",
  );
  const [settingJson, setSettingJson] = useState(
    JSON.stringify(
      {
        timezone: "Asia/Almaty",
        menuMinutes: 780,
        paymentMinutes: 780,
        skipMinutes: 840,
        addressMinutes: 840,
        deliveryMinutes: 840,
        standaloneAddonMinutes: 900,
        kitchenLockMinutes: 905,
        serviceDaysPerCycle: 30,
        maxPauseCalendarDays: 30,
      },
      null,
      2,
    ),
  );
  const [exportType, setExportType] = useState("FINANCIAL");
  const [exportFormat, setExportFormat] = useState("XLSX");
  const deviceId = "jantok-admin-browser";
  const c = copy[locale];
  useEffect(() => {
    const saved = window.localStorage.getItem("jantok-admin-locale");
    const timeout = window.setTimeout(() => {
      if (saved === "kk" || saved === "ru" || saved === "en") {
        setLocale(saved);
        document.documentElement.lang = saved;
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  function selectLocale(value: UiLocale) {
    setLocale(value);
    window.localStorage.setItem("jantok-admin-locale", value);
    document.documentElement.lang = value;
  }
  const localeSelect = (
    <select
      value={locale}
      onChange={(event) => selectLocale(event.target.value as UiLocale)}
      aria-label="Language"
    >
      <option value="kk">Қазақша</option>
      <option value="ru">Русский</option>
      <option value="en">English</option>
    </select>
  );

  const permissions = useMemo(
    () =>
      new Set(
        employee?.roles.flatMap((item) =>
          item.role.permissions.map((entry) => entry.permission.code),
        ) ?? [],
      ),
    [employee],
  );
  const allowedSections = useMemo(
    () => sections.filter((section) => permissions.has(section.permission)),
    [permissions],
  );
  const current =
    sections.find((section) => section.id === sectionId) ?? sections[0];

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!accessToken) throw new Error("Требуется вход");
      const response = await fetch(`${api}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-request-id": crypto.randomUUID(),
          ...(init?.headers ?? {}),
        },
      });
      const result = (response.headers.get("content-type") ?? "").includes(
        "application/json",
      )
        ? await response.json()
        : await response.blob();
      if (!response.ok)
        throw new Error(result?.error?.message ?? `HTTP ${response.status}`);
      return result;
    },
    [accessToken],
  );

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setMessage("");
    setSelected(undefined);
    try {
      const endpoint =
        current.endpoint ??
        `/staff/resources/${current.id}?page=${page}&pageSize=25`;
      const result = await call(endpoint);
      if (Array.isArray(result)) {
        setRows(result);
        setSummary(undefined);
      } else if (Array.isArray(result.items)) {
        setRows(result.items);
        setSummary(result);
      } else {
        setRows([]);
        setSummary(result);
      }
    } catch (error) {
      setRows([]);
      setSummary(undefined);
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [accessToken, call, current, page]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function requestOtp() {
    const response = await fetch(`${api}/auth/otp/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, deviceId }),
    });
    setMessage(response.ok ? "Код отправлен" : "Не удалось запросить код");
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch(`${api}/auth/otp/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone,
          code,
          deviceId,
          deviceName: "Admin browser",
          firstName: "Local",
          lastName: "Admin",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Ошибка входа");
      const token = result.accessToken as string;
      const staffResponse = await fetch(`${api}/staff/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const staff = await staffResponse.json();
      if (!staffResponse.ok)
        throw new Error(staff.error?.message ?? "Нет доступа персонала");
      setAccessToken(token);
      setEmployee(staff);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка входа");
    }
  }
  async function saveSetting(event: FormEvent) {
    event.preventDefault();
    try {
      await call("/staff/settings", {
        method: "POST",
        body: JSON.stringify({
          groupCode: settingGroup,
          key: settingKey,
          status: settingStatus,
          value: JSON.parse(settingJson),
          reason: settingReason,
          idempotencyKey: `admin-setting-${crypto.randomUUID()}`,
        }),
      });
      setMessage(
        "Версия сохранена; APPROVED сразу доступна mobile runtime config.",
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка настройки");
    }
  }
  async function createExport(event: FormEvent) {
    event.preventDefault();
    try {
      await call("/staff/analytics/exports", {
        method: "POST",
        body: JSON.stringify({ reportType: exportType, format: exportFormat }),
      });
      setMessage(
        "Экспорт построен из сохранённых данных и доступен владельцу job 7 дней.",
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка экспорта");
    }
  }
  async function rowAction(row: Record<string, unknown>) {
    try {
      if (sectionId === "customers") {
        const reason = window.prompt("Причина блокировки (будет в audit log)");
        if (
          !reason ||
          reason.length < 8 ||
          !window.confirm(
            `Заблокировать ${short(row.phone)} и отозвать сессии?`,
          )
        )
          return;
        await call(`/staff/customers/${row.id}/block`, {
          method: "PATCH",
          body: JSON.stringify({ blocked: true, reason }),
        });
      } else if (sectionId === "reviews") {
        const reason = window.prompt("Причина скрытия отзыва");
        if (!reason || reason.length < 4) return;
        await call(`/staff/reviews/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "HIDE", reason }),
        });
      } else if (sectionId === "support") {
        const body = window.prompt("Ответ клиенту");
        if (!body) return;
        await call(`/staff/support/threads/${row.id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            body,
            clientMessageId: `admin-${crypto.randomUUID()}`,
            attachments: [],
          }),
        });
      }
      setMessage("Операция выполнена и сохранена.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Операция не выполнена",
      );
    }
  }

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle))
      : rows;
    if (!sortKey) return filtered;
    return [...filtered].sort(
      (left, right) =>
        (descending ? -1 : 1) *
        short(left[sortKey]).localeCompare(short(right[sortKey]), "ru", {
          numeric: true,
        }),
    );
  }, [rows, search, sortKey, descending]);
  const columns = useMemo(() => {
    const keys = new Set<string>();
    visibleRows
      .slice(0, 20)
      .forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
    // Resource identifiers are still used as stable React/action keys, but are
    // not useful (and are easy to copy accidentally) in the operational UI.
    // Relations that need a human-facing value are returned by the API as a
    // name/phone/status field instead of exposing another UUID column.
    return [...keys]
      .filter(
        (key) =>
          key !== "id" &&
          !key.endsWith("Id") &&
          !key.endsWith("Ids") &&
          !key.startsWith("providerOperation"),
      )
      .slice(0, 8);
  }, [visibleRows]);

  if (!accessToken || !employee)
    return (
      <main className={styles.loginPage}>
        <form className={styles.loginCard} onSubmit={login}>
          <p className={styles.eyebrow}>JANTOK FOOD · STAFF</p>
          <h1>{c.admin}</h1>
          {localeSelect}
          <label>
            {c.phone}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <button
            type="button"
            className={styles.secondary}
            onClick={requestOtp}
          >
            {c.getOtp}
          </button>
          <label>
            {c.code}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              required
            />
          </label>
          <button type="submit">{c.login}</button>
          {message && <p className={styles.message}>{message}</p>}
        </form>
      </main>
    );

  const groups = [...new Set(allowedSections.map((section) => section.group))];
  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span>J</span>
          <div>
            <strong>JANTOK</strong>
            <small>Operations</small>
          </div>
        </div>
        <div className={styles.identity}>
          <strong>{employee.phone}</strong>
          <small>
            {employee.roles.map((item) => item.role.name).join(", ")}
          </small>
        </div>
        <nav>
          {groups.map((group) => (
            <section key={group} className={styles.navGroup}>
              <h2>{groupCopy[group]?.[locale] ?? group}</h2>
              {allowedSections
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    className={
                      item.id === sectionId
                        ? styles.activeNav
                        : styles.navButton
                    }
                    onClick={() => {
                      setSectionId(item.id);
                      setPage(1);
                      setSearch("");
                    }}
                  >
                    {sectionLabel(item, locale)}
                  </button>
                ))}
            </section>
          ))}
        </nav>
      </aside>
      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>
              {groupCopy[current.group]?.[locale] ?? current.group}
            </p>
            <h1>{sectionLabel(current, locale)}</h1>
          </div>
          <div className={styles.headerActions}>
            {localeSelect}
            <span className={styles.live}>{c.realData}</span>
            <button className={styles.secondary} onClick={() => void load()}>
              {c.refresh}
            </button>
          </div>
        </header>
        {message && (
          <div className={styles.notice}>
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}
        {sectionId === "settings" && (
          <form className={styles.actionPanel} onSubmit={saveSetting}>
            <div>
              <h2>{c.newSetting}</h2>
              <p>{c.secretWarning}</p>
            </div>
            <label>
              {c.group}
              <select
                value={settingGroup}
                onChange={(e) => setSettingGroup(e.target.value)}
              >
                {[
                  "CUTOFF",
                  "PRICING",
                  "CLUB",
                  "DELIVERY",
                  "LOYALTY",
                  "REFUND",
                  "SUPPORT",
                  "JOBS",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              {c.key}
              <input
                value={settingKey}
                onChange={(e) => setSettingKey(e.target.value.toUpperCase())}
                required
              />
            </label>
            <label>
              {c.status}
              <select
                value={settingStatus}
                onChange={(e) => setSettingStatus(e.target.value)}
              >
                <option>DRAFT</option>
                <option>DEMO</option>
                <option>APPROVED</option>
              </select>
            </label>
            <label className={styles.wide}>
              JSON
              <textarea
                value={settingJson}
                onChange={(e) => setSettingJson(e.target.value)}
                rows={8}
                required
              />
            </label>
            <label className={styles.wide}>
              {c.reason}
              <input
                value={settingReason}
                onChange={(e) => setSettingReason(e.target.value)}
                minLength={4}
                required
              />
            </label>
            <button type="submit">{c.save}</button>
          </form>
        )}
        {sectionId === "exports" && (
          <form className={styles.actionPanel} onSubmit={createExport}>
            <div>
              <h2>{c.protectedExport}</h2>
              <p>{c.exportHint}</p>
            </div>
            <label>
              {c.report}
              <select
                value={exportType}
                onChange={(e) => setExportType(e.target.value)}
              >
                {[
                  "FINANCIAL",
                  "KITCHEN",
                  "INVENTORY",
                  "CUSTOMERS",
                  "SUBSCRIPTIONS",
                  "DELIVERY",
                  "WASTE",
                  "MEALS",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              {c.format}
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
              >
                <option>XLSX</option>
                <option>CSV</option>
              </select>
            </label>
            <button type="submit">{c.create}</button>
          </form>
        )}
        {summary ? (
          <section className={styles.summaryGrid}>
            {Object.entries(summary).map(([key, value]) => (
              <article key={key} className={styles.metric}>
                <small>{columnLabel(key, locale)}</small>
                <strong>{summaryValue(key, value, locale)}</strong>
              </article>
            ))}
          </section>
        ) : (
          <section className={styles.tableCard}>
            <div className={styles.toolbar}>
              <input
                type="search"
                placeholder={c.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span>
                {visibleRows.length} {c.rows} · {c.page} {page}
              </span>
            </div>
            {loading ? (
              <div className={styles.state}>{c.loading}</div>
            ) : visibleRows.length === 0 ? (
              <div className={styles.state}>{c.noData}</div>
            ) : (
              <div className={styles.tableScroll}>
                <table>
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>
                          <button
                            onClick={() => {
                              if (sortKey === column)
                                setDescending(!descending);
                              else {
                                setSortKey(column);
                                setDescending(false);
                              }
                            }}
                          >
                            {columnLabel(column, locale)}
                            {sortKey === column
                              ? descending
                                ? " ↓"
                                : " ↑"
                              : ""}
                          </button>
                        </th>
                      ))}
                      <th>{c.action}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, index) => (
                      <tr
                        key={String(row.id ?? index)}
                        onClick={() => setSelected(row)}
                      >
                        {columns.map((column) => (
                          <td key={column} title={short(row[column])}>
                            {short(row[column])}
                          </td>
                        ))}
                        <td>
                          {["customers", "reviews", "support"].includes(
                            sectionId,
                          ) ? (
                            <button
                              className={styles.rowAction}
                              onClick={(event) => {
                                event.stopPropagation();
                                void rowAction(row);
                              }}
                            >
                              {sectionId === "customers"
                                ? c.block
                                : sectionId === "reviews"
                                  ? c.hide
                                  : c.reply}
                            </button>
                          ) : (
                            <button className={styles.linkButton}>
                              {c.details}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <footer className={styles.pagination}>
              <button
                disabled={page === 1}
                onClick={() => setPage((v) => Math.max(1, v - 1))}
              >
                ← {c.back}
              </button>
              <button
                disabled={rows.length < 25}
                onClick={() => setPage((v) => v + 1)}
              >
                {c.next} →
              </button>
            </footer>
          </section>
        )}
      </section>
      {selected && (
        <aside className={styles.drawer}>
          <header>
            <h2>{c.details}</h2>
            <button onClick={() => setSelected(undefined)}>×</button>
          </header>
          <pre>{JSON.stringify(selected, null, 2)}</pre>
        </aside>
      )}
    </main>
  );
}
