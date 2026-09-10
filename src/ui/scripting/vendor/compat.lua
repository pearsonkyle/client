-------------------------------------------------------------------
-- Table library
local tab = table

foreach = tab.foreach
foreachi = tab.foreachi
getn = tab.getn
tinsert = tab.insert
tremove = tab.remove
sort = tab.sort
wipe = tab.wipe

-------------------------------------------------------------------
-- math library
local math = math
abs = math.abs
acos = function (x) return math.deg(math.acos(x)) end
asin = function (x) return math.deg(math.asin(x)) end
atan = function (x) return math.deg(math.atan(x)) end
atan2 = function (x,y) return math.deg(math.atan2(x,y)) end
ceil = math.ceil
cos = function (x) return math.cos(math.rad(x)) end
deg = math.deg
exp = math.exp
floor = math.floor
frexp = math.frexp
ldexp = math.ldexp
log = math.log
log10 = math.log10
max = math.max
min = math.min
mod = math.fmod
PI = math.pi
--??? pow = math.pow
rad = math.rad
random = math.random
--randomseed = math.randomseed
sin = function (x) return math.sin(math.rad(x)) end
sqrt = math.sqrt
tan = function (x) return math.tan(math.rad(x)) end

-------------------------------------------------------------------
-- string library
local str = string
strbyte = str.byte
strchar = str.char
strfind = str.find
format = str.format
gmatch = str.gmatch
gsub = str.gsub
strlen = str.len
strlower = str.lower
strmatch = str.match
strrep = str.rep
strrev = str.reverse
strsub = str.sub
strupper = str.upper
-------------------------------------------------------------------
-- Add custom string functions to the string table
str.trim = strtrim
str.split = strsplit
str.join = strjoin
str.replace = strreplace

-------------------------------------------------------------------
-- Lua 5.1 globals that moved or vanished in 5.3
-- Fengari implements 5.3, but Blizzard's UI is written against 5.1, so the pieces
-- the UI still calls have to be put back.
unpack = unpack or tab.unpack
getn = getn or function (t) return #t end
setn = setn or function () end
loadstring = loadstring or load

-- string.gfind was renamed to gmatch
str.gfind = str.gfind or str.gmatch
gfind = str.gfind

-- math.mod / math.pow were removed
math.mod = math.mod or math.fmod
math.pow = math.pow or function (x, y) return x ^ y end
pow = math.pow

-- table.getn / table.setn were removed
tab.getn = tab.getn or function (t) return #t end
tab.setn = tab.setn or function () end
