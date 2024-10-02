type Options =
  | {
    arrayMode: true;
  }
  | {
    arrayMode: false;
  };

interface ParameterizedQuery {
  query: string;
  params: string[];
}

interface Field {
  name: string;
  tableID: number;
  columnID: number;
  dataTypeID: number;
  dataTypeSize: number;
  dataTypeModifier: number;
  format: string;
}

export interface Result {
  command: string;
  rowCount: number;
  rows: string[][];
  fields: Field[];
}

interface Prepareable {
  prepare(): ParameterizedQuery;
}

class Query<T> implements PromiseLike<ResultSet<T>>, Prepareable {
  fragment: boolean;
  constructor(
    public strings: TemplateStringsArray,
    public args: any[],
    private execute: (query: ParameterizedQuery) => Promise<ResultSet<T>>,
  ) { }
  static get [Symbol.species]() {
    return Promise;
  }
  public prepare() {
    const params: any[] = [];
    const query = stringify(this, this.strings[0], this.args[0], params);
    return { query: query.query, params };
  }
  public handle() {
    const query = this.prepare();
    return this.execute(query);
  }
  then(
    resolve: (onfulfilled: ResultSet<T>) => any,
    reject: (reason: any) => PromiseLike<any>,
  ) {
    return this.handle().then(resolve, reject);
  }
  catch(reject: (reason: any) => PromiseLike<any>) {
    return this.handle().catch(reject);
  }
  finally(onfinally?: () => void) {
    return this.handle().finally(onfinally);
  }
}

class Raw<T> implements PromiseLike<ResultSet<T>>, Prepareable {
  constructor(
    private query: string,
    private params: any[],
    private execute: (query: ParameterizedQuery) => Promise<ResultSet<T>>,
  ) { }
  static get [Symbol.species]() {
    return Promise;
  }
  public prepare() {
    return {
      query: this.query,
      params: this.params.map(serialize),
    } as ParameterizedQuery;
  }
  public handle() {
    const query = this.prepare();
    return this.execute(query);
  }
  then(
    resolve: (onfulfilled: ResultSet<T>) => any,
    reject: (reason: any) => PromiseLike<any>,
  ) {
    return this.handle().then(resolve, reject);
  }
  catch(reject: (reason: any) => PromiseLike<any>) {
    return this.handle().catch(reject);
  }
  finally(onfinally?: () => void) {
    return this.handle().finally(onfinally);
  }
}

class Identifier {
  constructor(private value: string) { }
  public prepare() {
    return escapeIdentifier(this.value);
  }
}

function escapeIdentifier(str: string) {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
}

type ResultSet<T = any> = T[] & { command: string; count: number };
function processResult<T extends any[]>(
  result: Result,
  arrayMode?: false,
): ResultSet<T>;
function processResult<T extends Record<string, any>>(
  result: Result,
  arrayMode: true,
): ResultSet<T>;
function processResult(result: Result, arrayMode?: boolean): ResultSet<any> {
  const colNames = result.fields.map((field) => field.name);
  const set = result.rows.map((row) => {
    return arrayMode
      ? (row.map((value, index) => {
        const dataTypeId = result.fields[index].dataTypeID ?? -1;
        return deserialize(value, dataTypeId);
      }) as any)
      : Object.fromEntries(
        row.map((value, index) => {
          const dataTypeId = result.fields[index].dataTypeID ?? -1;
          return [colNames[index], deserialize(value, dataTypeId)] as const;
        }),
      );
  }) as ResultSet<any>;
  set.command = result.command;
  set.count = result.rowCount;
  return set;
}

function deserialize(value: string, dataTypeId: number) {
  if (value === null) return null;
  switch (dataTypeId) {
    case 21:
    case 23:
    case 26:
    case 700:
    case 701:
      return +value;
    case 17: // bytea
      return Buffer.from(value.slice(2), "hex");
    case 16: // bool
      return value === "t";
    case 20: // bigint
      return BigInt(value);
    case 0: // numbers
    case 25: // text
      return value;
    case 1184: // dates
    case 1082:
    case 1114:
      return new Date(value);
    case 3802: // json
    case 114: // jsonb
      return JSON.parse(value);
    default:
      return value;
  }
}

export interface SQL<arrayMode = false> {
  (
    string: string,
  ): Identifier;
  <T = arrayMode extends true ? any[] : Record<string, any>>(
    strings: TemplateStringsArray,
    ...args: any[]
  ): Query<T>;
  <T = arrayMode extends true ? any[] : Record<string, any>>(
    strings: string,
    args: any[],
  ): Query<T>;
  begin: (queries: PromiseLike<ResultSet<any>>[]) => Promise<ResultSet<any>[]>;
}

function stringify(
  q: Query<any>,
  string: string,
  value: any,
  params: string[],
) {
  for (let i = 1; i < q.strings.length; i++) {
    string += stringifyValue(value, params) + q.strings[i];
    value = q.args[i];
  }
  return { query: string, params };
}

function stringifyValue(value: any, parameters: string[]) {
  return value instanceof Query
    ? stringify(value, value.strings[0], value.args[0], parameters)
    : value instanceof Identifier
      ? value.prepare()
      : value && value[0] instanceof Query
        ? value.reduce(
          (acc: string, x: Query<any>) =>
            acc +
            " " +
            stringify(x, x.strings[0], x.args[0], parameters),
          "",
        )
        : handleValue(value, parameters);
}

function handleValue(x: any, params: string[]) {
  return "$" + params.push(serialize(x));
}

export function postgres(
  connectionString: string,
  options: Extract<Options, { arrayMode: false }>,
): SQL<false>;
export function postgres(
  connectionString: string,
  options: Extract<Options, { arrayMode: true }>,
): SQL<true>;
export function postgres(connectionString: string, options?: Options) {
  const parsed = parseUrl(connectionString);

  // execute the query
  async function execute<
    T = (typeof options)["arrayMode"] extends true
    ? any[]
    : Record<string, any>,
  >(query: ParameterizedQuery) {
    const response = await fetch(`https://${parsed.url.hostname}/sql`, {
      method: "POST",
      headers: {
        "Neon-Connection-String": connectionString,
        "Neon-Raw-Text-Output": "true",
        "Neon-Array-Mode": options.arrayMode ? "true" : "false",
      },
      body: JSON.stringify(query),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = (await response.json()) as Result;
    return processResult<T>(data, options.arrayMode as any);
  }

  // generate the query
  function sql(string: string): Identifier;
  function sql<
    T = (typeof options)["arrayMode"] extends true
    ? any[]
    : Record<string, any>,
  >(string: string, args: any[]): PromiseLike<ResultSet<T[]>>;
  function sql<
    T = (typeof options)["arrayMode"] extends true
    ? any[]
    : Record<string, any>,
  >(string: TemplateStringsArray, ...args: any[]): PromiseLike<ResultSet<T[]>>;
  function sql<T = any>(
    strings: any,
    ...args: any[]
  ): PromiseLike<ResultSet<T>> | Identifier {
    const query =
      strings && Array.isArray(strings.raw)
        ? new Query<T>(strings, args, execute)
        : typeof strings === "string" && !args.length
          ? new Identifier(strings)
          : new Raw<T>(strings, args[0], execute);
    return query;
  }

  interface TransactionOptions {
    isolationLevel?:
    | 'ReadUncommitted'
    | 'ReadCommitted'
    | 'RepeatableRead'
    | 'Serializable';
    readOnly?: boolean;
    deferrable?: boolean;
  }

  sql.begin = async (queries: Array<Prepareable>, opts: TransactionOptions) => {
    const headers = {
      "Neon-Connection-String": connectionString,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": options.arrayMode ? "true" : "false",
    };
    if (opts.isolationLevel !== undefined) {
      headers['Neon-Batch-Isolation-Level'] = opts.isolationLevel!;
    }
    if (opts.readOnly !== undefined) {
      headers['Neon-Batch-Read-Only'] = opts.readOnly!;
    }
    if (opts.deferrable !== undefined) {
      headers['Neon-Batch-Deferrable'] = opts.deferrable!;
    }
    const response = await fetch(`https://${parsed.url.hostname}/sql`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queries: queries.map((q) => {
          if (q && "prepare" in q) {
            return q.prepare();
          }
          throw new Error("begin only accepts Queries made by `sql` function");
        }),
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = (await response.json()) as { results: Result[] };
    return data.results.map((r) =>
      processResult<any>(r, options.arrayMode as any),
    ) as ResultSet<any>[];
  };
  return sql as unknown as SQL<
    (typeof options)["arrayMode"] extends true ? true : false
  >;
}

function parseUrl(url: string) {
  if (!url || typeof url !== "string")
    return { url: { searchParams: new Map() } };

  let host = url;
  host = host.slice(host.indexOf("://") + 3).split(/[?/]/)[0];
  host = decodeURIComponent(host.slice(host.indexOf("@") + 1));

  const urlObj = new URL(url.replace(host, host.split(",")[0]));

  return {
    url: {
      username: decodeURIComponent(urlObj.username),
      password: decodeURIComponent(urlObj.password),
      host: urlObj.host,
      hostname: urlObj.hostname,
      port: urlObj.port,
      pathname: urlObj.pathname,
      searchParams: urlObj.searchParams,
    },
    multihost: host.indexOf(",") > -1 && host,
  };
}

function serialize(x: any) {
  if (x === null) return "null";
  switch (typeof x) {
    case "string":
      return x;
    case "number":
      return "" + x;
    case "boolean":
      return x ? "t" : "f";
    case "bigint":
      return x.toString();
    case "object":
      if (x instanceof Date) {
        return x.toISOString();
      }
      if (Array.isArray(x)) {
        return "{" + x.map(serialize).join(",") + "}";
      }
      return JSON.stringify(x);
    default:
      return JSON.stringify(x);
  }
}
