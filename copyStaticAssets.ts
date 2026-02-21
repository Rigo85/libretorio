import { execSync } from "child_process";
import path from "path";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

run("cp -R src/services/calibre dist/services");
// run("mkdir -p dist/public/covers");
// run("mkdir -p dist/public/temp_covers");
// run("mkdir -p dist/public/cache");
// run("mkdir -p dist/public/books");
run("mkdir -p dist/public");

run("cp -R src/browser/. dist/public");

run("ln -sfn /media/RIGO7/BACKUP/LIBROS dist/public/books");
run("ln -sfn /media/RIGO7/Libretorio-conf/covers dist/public/covers");
run("ln -sfn /media/RIGO7/Libretorio-conf/cache dist/public/cache");
run("ln -sfn /media/RIGO7/Libretorio-conf/temp_covers dist/public/temp_covers");

const publicDir = path.join("dist/public", `${__dirname.slice(1)}-Scanner`, "dist/public");
run(`mkdir -p ${publicDir}`);
run(`ln -sfn ${path.join(__dirname, "dist/public/books")} ${path.join(publicDir, "books")}`);
