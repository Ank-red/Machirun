// --- Types ---

/** 1つの停留所における到着・発車予定時刻 */
export interface StopSchedule {
  name: string;
  arrival: string | null;
  departure: string | null;
}

/** 1便分の運行ダイヤ情報 */
export interface BusTrip {
  trainNumber: string;
  operationDay: string;
  operationNumber: string;
  destination: string;
  stops: StopSchedule[];
}

// --- Constants ---

const META_KEYS = ["列車番号", "運転日", "運用番号", "両数", "種別・愛称", "号数", "行き先"];
const FOOTER_KEYS = ["連続する列車", "備考"];

// --- Functions ---

/**
 * OptDia形式のCSV文字列をパースし、便ごとの運行ダイヤ配列を返す
 * @param csvText OptDia形式のCSVテキスト
 * @returns パースされた便データの配列
 */
export function parseOptDiaCsv(csvText: string): BusTrip[] {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));

  const rowMap = new Map<string, string[]>();
  const stopRows: { name: string; type: string; times: string[] }[] = [];

  for (const cols of lines) {
    const key = cols[0]?.replace(/^\uFEFF/, "").trim();
    const type = cols[1]?.trim() || "";
    const values = cols.slice(2);

    if (!key || FOOTER_KEYS.includes(key)) continue;

    if (META_KEYS.includes(key)) {
      rowMap.set(key, values);
    } else {
      stopRows.push({ name: key, type, times: values });
    }
  }

  const trainNumbers = rowMap.get("列車番号") || [];
  const operationDays = rowMap.get("運転日") || [];
  const operationNumbers = rowMap.get("運用番号") || [];
  const destinations = rowMap.get("行き先") || [];

  return trainNumbers
    .map((trainNum, colIdx) => {
      const stops: StopSchedule[] = [];

      for (const row of stopRows) {
        const time = row.times[colIdx]?.trim() || "";
        if (!time) continue;

        const prevStop = stops[stops.length - 1];
        if (prevStop && prevStop.name === row.name && row.type === "発" && !prevStop.departure) {
          prevStop.departure = time;
        } else {
          stops.push({
            name: row.name,
            arrival: row.type === "着" ? time : null,
            departure: row.type !== "着" ? time : null,
          });
        }
      }

      return {
        trainNumber: trainNum.trim(),
        operationDay: operationDays[colIdx]?.trim() || "",
        operationNumber: operationNumbers[colIdx]?.trim() || "",
        destination: destinations[colIdx]?.trim() || "",
        stops,
      };
    })
    .filter((trip) => trip.trainNumber && trip.stops.length > 0);
}

/**
 * CSVテキストから路線全体の重複なしマスター停留所名リストを抽出する
 * @param csvText OptDia形式のCSVテキスト
 * @returns 停留所名の配列（出現順）
 */
export function extractMasterStops(csvText: string): string[] {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));

  const stopNames: string[] = [];

  for (const cols of lines) {
    const key = cols[0]?.replace(/^\uFEFF/, "").trim();
    if (!key || META_KEYS.includes(key) || FOOTER_KEYS.includes(key)) {
      continue;
    }

    // 直前の停留所名と同じ場合は、「着と発のペア」とみなして重複追加しない
    // ※ただし、路線が進んだあとに再び同じ駅に戻ってきた場合は別として追加される
    const lastStop = stopNames[stopNames.length - 1];
    if (lastStop !== key) {
      stopNames.push(key);
      console.log(key);

    }
  }

  return stopNames;
}

/**
 * 便番号（百の位）の規則に基づき、指定日時に運行する便のみを抽出する
 * - 午前4時未満は前日営業日として扱う
 * - 300/400番台: 当日が土休日の場合のみ運行
 * - 500/600番台: 翌日が土休日の場合のみ運行
 * - その他(100/200番台等): 毎日運行
 * @param trips 全便データの配列
 * @param now 判定基準日時（省略時は現在時刻）
 * @returns 当日運行する便データの配列
 */
export function getTodayTrips(trips: BusTrip[], now: Date = new Date()): BusTrip[] {
  const serviceDate = new Date(now);
  if (serviceDate.getHours() < 4) {
    serviceDate.setDate(serviceDate.getDate() - 1);
  }

  const nextDate = new Date(serviceDate);
  nextDate.setDate(serviceDate.getDate() + 1);

  const isTodayHoliday = serviceDate.getDay() === 0 || serviceDate.getDay() === 6;
  const isTomorrowHoliday = nextDate.getDay() === 0 || nextDate.getDay() === 6;

  return trips.filter((trip) => {
    const num = Number(trip.trainNumber);
    const hundreds = Math.floor(num / 100);

    if (hundreds === 3 || hundreds === 4) return isTodayHoliday;
    if (hundreds === 5 || hundreds === 6) return isTomorrowHoliday;
    return true;
  });
}