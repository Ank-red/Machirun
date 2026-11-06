export interface StopSchedule {
  name: string;
  arrival: string | null;
  departure: string | null;
}

export interface BusTrip {
  trainNumber: string;
  operationDay: string;
  operationNumber: string;
  destination: string;
  stops: StopSchedule[];
}

// 1. CSVパース処理
export function parseOptDiaCsv(csvText: string): BusTrip[] {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));

  const rowMap = new Map<string, string[]>();
  const stopRows: { name: string; type: string; times: string[] }[] = [];

  const metaKeys = ["列車番号", "運転日", "運用番号", "両数", "種別・愛称", "号数", "行き先"];
  const footerKeys = ["連続する列車", "備考"];

  for (const cols of lines) {
    const key = cols[0]?.replace(/^\uFEFF/, "").trim(); // BOM除去
    const type = cols[1]?.trim() || "";
    const values = cols.slice(2);

    if (!key || footerKeys.includes(key)) continue;

    if (metaKeys.includes(key)) {
      rowMap.set(key, values);
    } else {
      stopRows.push({ name: key, type, times: values });
    }
  }

  const trainNumbers = rowMap.get("列車番号") || [];
  const operationDays = rowMap.get("運転日") || [];
  const operationNumbers = rowMap.get("運用番号") || [];
  const destinations = rowMap.get("行き先") || [];

  return trainNumbers.map((trainNum, colIdx) => {
    const stops: StopSchedule[] = [];

    for (const row of stopRows) {
      const time = row.times[colIdx]?.trim() || "";
      if (!time) continue; // 通過またはデータなしの停留所はスキップ

      const prevStop = stops[stops.length - 1];
      // 直前の行と同じ停留所名で「着 → 発」となっている場合は1つに統合
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
  }).filter((trip) => trip.trainNumber && trip.stops.length > 0);
}

// 2. CSVから路線全体の重複なしマスター停留所名リストを抽出（エディタ用）
export function extractMasterStops(csvText: string): string[] {
  const trips = parseOptDiaCsv(csvText);
  const stopSet = new Set<string>();
  for (const trip of trips) {
    for (const stop of trip.stops) {
      stopSet.add(stop.name);
    }
  }
  return Array.from(stopSet);
}

// 3. 便名（百の位）による当日運行便のフィルタリング
export function getTodayTrips(trips: BusTrip[], now: Date = new Date()): BusTrip[] {
  // 午前4時より前は「前日の深夜営業」として扱う
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

    // 300・400番台は当日が土休日のときのみ運行
    if (hundreds === 3 || hundreds === 4) return isTodayHoliday;
    // 500・600番台は翌日が土休日のときのみ運行（翌平日運休）
    if (hundreds === 5 || hundreds === 6) return isTomorrowHoliday;
    // 100・200番台（それ以外）は毎日運行
    return true;
  });
}