const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const ghpages = require('gh-pages');

const dbDir = path.normalize(__dirname + "/../chinese-poetry");
const tbrDir = path.normalize(__dirname + "/tbr");
const rankEntry = "rank";
const shiEntry = "json";
const ciEntry = "ci";
const quEntry = "yuanqu";
const excludedPath = ["error"];

async function walker(directory, res = []) {
  const dirents = await fsp.readdir(directory, {withFileTypes: true});
  for (dirent of dirents) {
    if (dirent.isDirectory() && !excludedPath.includes(dirent.name)) {
      await walker(path.join(directory, dirent.name), res);
    } else if (dirent.isFile()) {
      res.push(path.join(directory, dirent.name));
    }
  }
  
  return res;
}

async function extractFor({beforeAdd, criteria, libName, name, desc, files}) {
  const extracted = {libName, name, desc, lastUpdated: Date.now(), data: []};
  for (let file of files) {
    const data = JSON.parse(await fsp.readFile(file, {encoding: 'utf-8'}));
    data.forEach(corpus => {
      if (criteria(corpus)) {
        extracted.data.push(beforeAdd(corpus, file));
      }
    });
  }
  extracted.count =  extracted.data.length;
  console.log(`Extracted all ${extracted.count} for ${libName}.json`);
  if (extracted.count > 0) {
    await fsp.writeFile(`${tbrDir}/${libName}.json`, JSON.stringify(extracted));
    // console.log("example: ", JSON.stringify(extracted.data[0], null, 2));
  }
  return extracted;
}


async function getAllJsons(p) {
  return (await walker(p)).filter(p => p.endsWith('json'));
}

async function extractTopRanked({beforeAdd, comparator, libName, name, desc, topX, rankFiles, corpusFiles}) {
  const extracted = {libName, name, desc, lastUpdated: Date.now(), data: []};
  // get top ranked ids (file-name-idx)
  const topXList = [];
  for (let file of rankFiles) {
    const data = JSON.parse(await fsp.readFile(file, {encoding: 'utf-8'}));
    data.forEach((rank, i) => {
      if (topXList.length < topX) {
        topXList.push({rank, id: `${file.split("/").pop()}-${i}`});
      } else {
        const lowest = topXList.reduce((a, b) => comparator(a.rank, b.rank) ? b : a);
        if (comparator(rank, lowest.rank)) {
           lowest.rank = rank;
           lowest.id = `${file.split("/").pop()}-${i}`;
        }
      }
    });
  }
  extracted.count = topX;

  // get all the corpus back
  for (let topName of topXList) {
    const targetFile = corpusFiles.find(f => f.split("/").pop() === topName.id.split("-")[0].replace("rank.", ''));
    const data = JSON.parse(await fsp.readFile(targetFile, {encoding: 'utf-8'}));
    extracted.data.push(beforeAdd(data[topName.id.split("-")[1]]));
  }
  console.log(`Extracted all ${extracted.count} for ${libName}.json`);
  if (extracted.count > 0) {
    await fsp.writeFile(`${tbrDir}/${libName}.json`, JSON.stringify(extracted));
    // console.log("example: ", JSON.stringify(extracted.data[0], null, 2));
  }
  return extracted;
}

function reformatShiIfNeeded(corpus) {
  const pCount = corpus.paragraphs.map(p => p.length).reduce((cm, cur) => {
    cm.set(cur, (cm.get(cur) || 0) + 1);
    return cm;
  }, new Map());
  if (pCount.size > 1) {
    let commonLength = [...pCount.entries()].reduce((a, e ) => e[1] > a[1] ? e : a)[0];
    corpus.paragraphs = corpus.paragraphs.reduce((p, c) => {
      if (c.length === commonLength * 2) {
        p.push(c.substr(0, commonLength));
        p.push(c.substr(commonLength, commonLength));
      } else {
        p.push(c);
      }
      return p;
    }, []);
  }
}

async function extractShiCiFor({author, libNamePrefix, files}) {
  const ci = await extractFor({
    beforeAdd: corpus => (corpus.type = "ci") && corpus,
    criteria: corpus => corpus.author === author,
    name: `${author}词全集`,
    desc: "",
    libName: `${libNamePrefix}_ci`,
    files: files.allCi,
  });

  const shi = await extractFor({
    beforeAdd: corpus => {
      corpus.type = "shi";
      reformatShiIfNeeded(corpus);
      return corpus;
    },
    criteria: corpus => corpus.author === author,
    name: `${author}诗全集`,
    desc: "",
    libName: `${libNamePrefix}_shi`,
    files: files.allShi,
  });

  if (ci.count && shi.count) {
    await extractFor({
      beforeAdd: (corpus, file) => (file.includes("ci.") ? (corpus.type = "ci") : (corpus.type = "shi")) && corpus,
      criteria: corpus => corpus.author === author,
      name: `${author}诗词全集`,
      desc: "",
      libName: `${libNamePrefix}_shi_ci`,
      files: files.allShi.concat(files.allCi),
    });
  }
}

async function generateMeta() {
  const allDataSets = (await walker(tbrDir)).filter(p => p.endsWith('json') && !p.endsWith('meta.json'));
  const meta = {lastUpdated: Date.now(), data: []};
  // const extracted = {libName, name, desc, lastUpdated: Date.now(), data: []};
  for (let ds of allDataSets) {
    const lib = JSON.parse(await fsp.readFile(ds, {encoding: 'utf-8'}));
    meta.data.push({
      id: lib.libName,
      name: lib.name,
      desc: lib.desc,
      lastUpdated: lib.lastUpdated,
      count: lib.count,
    });
  }
  await fsp.writeFile(path.join(tbrDir, 'meta.json'), JSON.stringify(meta));
  // console.log(meta);
}

async function run() {
  const allShi = (await getAllJsons(path.join(dbDir, shiEntry))).filter(p => p.split("/").pop().startsWith("poet"));
  const allShiRank = await getAllJsons(path.join(dbDir, rankEntry, 'poet'));
  const allCi = (await getAllJsons(path.join(dbDir,ciEntry))).filter(p => p.split("/").pop().startsWith('ci'));
  const allCiRank = await getAllJsons(path.join(dbDir, rankEntry, ciEntry));
  const allQu = await getAllJsons(path.join(dbDir, quEntry));

  await extractTopRanked({
    beforeAdd: corpus => {
      corpus.type = "shi";
      reformatShiIfNeeded(corpus);
      return corpus;
    },
    libName: "baidu_top_30_shi",
    name:"百度唐诗TOP 30首",
    topX: 30,
    desc:"根据百度搜索结果数排序而获得的最流行的30首唐诗",
    rankFiles: allShiRank,
    corpusFiles: allShi,
    comparator(a,b) { return a.baidu > b.baidu; },
  });

  await extractTopRanked({
    beforeAdd: corpus => {
      corpus.type = "shi";
      reformatShiIfNeeded(corpus);
      return corpus;
    },
    libName: "google_top_30_shi",
    name:"谷歌唐诗Top 30首",
    topX: 30,
    desc:"根据谷歌搜索结果数排序而获得的最流行的30首唐诗",
    rankFiles: allShiRank,
    corpusFiles: allShi,
    comparator(a,b) { return a.google > b.google; },
  });
  await extractShiCiFor({author: "李白", libNamePrefix: "libai", files: {allCi, allShi}});
  await extractShiCiFor({author: "苏轼", libNamePrefix: "sushi", files: {allCi, allShi}});
  await extractShiCiFor({author: "杜甫", libNamePrefix: "dufu", files: {allCi, allShi}});
  await extractShiCiFor({author: "柳永", libNamePrefix: "liuyong", files: {allCi, allShi}});

  // generate meta
  await generateMeta();
  ghpages.publish('tbr', {branch: 'release'});
}

run()
