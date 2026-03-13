// by SoKo for kriptoentuzijasti.io
// last update: March 4, 2026

let searchArray = [];
let latestData = [];
let arrFavsObj = [];
let coinsStorage = [];
const CACHE_EXPIRY = 360000;
const MAX_PAGES = 1;

function checkAndRequestPermissions(callback) {
    // In standalone electron app, chrome.permissions might not exist.
    if (typeof chrome === 'undefined' || !chrome.permissions) {
        console.log("Not in a standard Chrome extension environment. Proceeding automatically.");
        return callback();
    }

    const origin = "https://api.coingecko.com/*";

    chrome.permissions.contains({
        origins: [origin]
    }, (result) => {
        if (result) {
            callback();
        } else {
            showPermissionPrompt(origin, callback);
        }
    });
}

function showPermissionPrompt(origin, callback) {
    jQuery('#cryptoTable').html(`
		<td colspan="3" style="text-align: center; padding: 60px 10px; border: none; background: transparent;">
			<div class="permission-prompt" style="display: block; margin: 0 auto; max-width: 480px; text-align: center;">
				<h2 style="margin-bottom: 20px; font-weight: 700; color: var(--text-primary); font-size: 28px;">Data Access Permission</h2>
				<p style="font-size: 16px; color: var(--text-secondary); margin-bottom: 35px; line-height: 1.7; padding: 0 30px;">
					Please grant permission to enable cryptocurrency search and fetch the latest market updates.
				</p>
				<button id="grantPermissionBtn" class="btn btn-primary" style="background-color: #2196F3; border: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 10px rgba(33, 150, 243, 0.25); display: inline-block; font-size: 16px; transition: all 0.2s ease;">
					Grant Access
				</button>
			</div>
		</td>
	`);

    $('#grantPermissionBtn').on('click', () => {
        chrome.permissions.request({
            origins: [origin]
        }, (granted) => {
            if (granted) {
                location.reload();
            } else {
                alert("Access is required to search for cryptocurrencies.");
            }
        });
    });
}

$(document).ready(function () {
    checkAndRequestPermissions(() => {
        start();

        $("#resetFav").click(function () {
            jQuery('#displayFavorites').html('');
            arrFavsObj = [];
            localStorage.removeItem('arrFavsObj');
        });

        $("#forceRefresh").click(function () {
            localStorage.removeItem('cryptoData');
            start();
        });
    });
});
function start() {
    let milliseconds = (new Date).getTime();

    let storedFavs = localStorage.getItem("arrFavsObj");
    if (storedFavs !== null) {
        let parsedFavs = JSON.parse(storedFavs);
        let needsMigration = false;

        for (let i = 0; i < parsedFavs.length; i++) {
            if (parsedFavs[i].name === undefined || parsedFavs[i].symbol === undefined) {
                needsMigration = true;
                break;
            }
        }

        if (needsMigration) {
            console.log("Migrating old favorites format...");
            // Fetch basic data for these IDs to get their names and symbols
            let ids = parsedFavs.map(f => f.favsId).join(',');
            if (ids) {
                $.ajax({
                    type: "GET",
                    url: "https://api.coingecko.com/api/v3/coins/markets",
                    dataType: "json",
                    data: {
                        vs_currency: "usd",
                        ids: ids
                    },
                    success: function (data) {
                        let newFavs = [];
                        parsedFavs.forEach((oldFav, idx) => {
                            let coinData = data.find(c => c.id === oldFav.favsId);
                            if (coinData) {
                                newFavs.push({
                                    favsId: coinData.id,
                                    storedFavs: oldFav.storedFavs || idx.toString(),
                                    name: coinData.name,
                                    symbol: coinData.symbol,
                                    image: coinData.image
                                });
                            } else {
                                newFavs.push(oldFav);
                            }
                        });
                        localStorage['arrFavsObj'] = JSON.stringify(newFavs);
                        arrFavsObj = newFavs;
                        if (typeof displayFavs === 'function') displayFavs(arrFavsObj);
                    }
                });
            }
        }
    }

    if (localStorage.getItem("cryptoData") === null ||
        JSON.parse(localStorage.getItem("cryptoData"))[0].updated + CACHE_EXPIRY <= milliseconds) {
        getCoinData();
    } else {
        latestData = JSON.parse(localStorage['cryptoData']);
        searchArray = [];
        latestData.forEach(function (item, key) {
            if (item.name) searchArray.push(item.name);
        });
        orderPages(latestData);
    }

    function getCoinData() {
        displayLoadingState("Loading coin data... (0/1500)");

        // Use Promise.all to fetch multiple pages in parallel
        let fetchPromises = [];

        for (let page = 1; page <= MAX_PAGES; page++) {
            fetchPromises.push(fetchCoinPage(page));
        }

        Promise.all(fetchPromises)
            .then(allPagesData => {
                let combinedData = [].concat(...allPagesData);

                coinsStorage = [{
                    updated: milliseconds
                }].concat(combinedData);

                localStorage['cryptoData'] = JSON.stringify(coinsStorage);
                latestData = coinsStorage;
                latestData = coinsStorage;

                console.log(`Loaded ${combinedData.length} coins successfully`);
                orderPages(latestData);
            })
            .catch(error => {
                console.error("Failed to fetch page:", error);
                handleAPIError();
            });
    }

    function fetchCoinPage(page) {
        return new Promise((resolve, reject) => {
            displayLoadingState(`Loading coin data...`);

            $.ajax({
                type: "GET",
                url: "https://api.coingecko.com/api/v3/coins/markets",
                dataType: "json",
                data: {
                    vs_currency: "usd",
                    order: "market_cap_desc",
                    per_page: 250,
                    page: page,
                    sparkline: false,
                    price_change_percentage: "24h"
                },
                crossDomain: true,
                success: function (data) {
                    const transformedData = data.map(item => {
                        return {
                            id: item.id,
                            symbol: item.symbol,
                            name: item.name,
                            rank: item.market_cap_rank,
                            priceUsd: item.current_price,
                            changePercent24Hr: item.price_change_percentage_24h,
                            marketCapUsd: item.market_cap,
                            image: item.image || getDefaultImage(item.symbol)
                        };
                    });
                    resolve(transformedData);
                },
                error: function (xhr, status, error) {
                    console.error(`API Error on page ${page}:`, error);
                    if (xhr.status === 429) {
                        setTimeout(() => {
                            $.ajax({
                                type: "GET",
                                url: "https://api.coingecko.com/api/v3/coins/markets",
                                dataType: "json",
                                data: {
                                    vs_currency: "usd",
                                    order: "market_cap_desc",
                                    per_page: 250,
                                    page: page,
                                    sparkline: false,
                                    price_change_percentage: "24h"
                                },
                                crossDomain: true,
                                success: function (retryData) {
                                    const transformedData = retryData.map(item => {
                                        return {
                                            id: item.id,
                                            symbol: item.symbol,
                                            name: item.name,
                                            rank: item.market_cap_rank,
                                            priceUsd: item.current_price,
                                            changePercent24Hr: item.price_change_percentage_24h,
                                            marketCapUsd: item.market_cap,
                                            image: item.image || getDefaultImage(item.symbol)
                                        };
                                    });
                                    resolve(transformedData);
                                },
                                error: function () {
                                    resolve([]);
                                }
                            });
                        }, 2000);
                    } else {
                        resolve([]);
                    }
                }
            });
        });
    }

    function displayLoadingState(message) {
        jQuery('#cryptoTable').html('');
        jQuery('#cryptoTable').html(`<td><div class='spinner-grow' role='status'><span class='sr-only'>Loading...</span></div></td><td colspan='2'><h4>${message}</h4></td>`);
    }

    function handleAPIError(isRateLimit = false) {
        if (isRateLimit) {
            jQuery('#cryptoTable').html("<td colspan='3'><div style='color: #e57373; font-size: 13px; font-weight: normal; text-align: center; margin: 15px 0;'>CoinGecko API rate limit reached.<br>Please wait a minute and try again.</div></td>");
        } else {
            jQuery('#cryptoTable').html("<td colspan='3'><h4>Error loading data. Using cached data if available.</h4></td>");
        }

        if (localStorage.getItem("cryptoData") !== null) {
            latestData = JSON.parse(localStorage['cryptoData']);
            orderPages(latestData);
        } else if (!isRateLimit) {
            jQuery('#cryptoTable').html("<td colspan='3'><h4>No data available. Please check your internet connection and try again.</h4></td>");
        }
    }

    function getDefaultImage(symbol) {
        return "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";
    }

    function orderPages(data) {
        jQuery('#cryptoTable').html('');

        function addToFavorites(favsId, name, symbol, image) {
            if (localStorage.getItem("arrFavsObj") !== null) {
                arrFavsObj = JSON.parse(localStorage['arrFavsObj']);
            }

            if (arrFavsObj.findIndex(x => x.favsId == favsId) < 0) {
                let nextIndex = 0;
                if (arrFavsObj.length > 0) {
                    nextIndex = Math.max(...arrFavsObj.map(f => parseInt(f.storedFavs) || 0)) + 1;
                }

                arrFavsObj.push({
                    favsId: favsId,
                    storedFavs: nextIndex.toString(),
                    name: name,
                    symbol: symbol,
                    image: image
                });
                localStorage['arrFavsObj'] = JSON.stringify(arrFavsObj);
            }
            displayFavs(arrFavsObj);
        }

        function displayFavs(displayTheseFavs) {
            jQuery('#displayFavorites').html('');
            for (let i = 0; i < displayTheseFavs.length; i++) {
                let fav = displayTheseFavs[i];

                b = document.createElement("TR");
                let imageUrl = fav.image || "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";
                let displayName = fav.name || fav.favsId;
                let displaySymbol = fav.symbol ? fav.symbol.toUpperCase() : "";

                b.innerHTML = "<td><img src=\"" + imageUrl + "\" class=\"coin-icon\"></td><td>"
                    + displaySymbol + " - " + displayName + "</td><td></td>"
                    + "<input type='hidden' value='" + fav.favsId + "'>";
                b.querySelector("img").addEventListener("error", function () {
                    this.src = "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";
                });
                b.addEventListener("click", function (e) {
                    let thisValue = this.getElementsByTagName("input")[0].value;
                    arrFavsObj.splice(arrFavsObj.findIndex(x => x.favsId == thisValue), 1);
                    localStorage['arrFavsObj'] = JSON.stringify(arrFavsObj);
                    displayFavs(arrFavsObj);
                });
                $("#displayFavorites").append(b);
            }
        }

        function autocomplete(inp) {
            let debounceTimeout;

            inp.addEventListener("input", function (e) {
                clearTimeout(debounceTimeout);
                let val = this.value;

                if (!val || val.length < 2) {
                    jQuery('#cryptoTable').html('');
                    displayTop100();
                    return false;
                }

                debounceTimeout = setTimeout(() => {
                    jQuery('#cryptoTable').html("<td><div class='spinner-grow spinner-grow-sm' role='status'></div></td><td colspan='2'>Searching...</td>");

                    $.ajax({
                        type: "GET",
                        url: "https://api.coingecko.com/api/v3/search",
                        dataType: "json",
                        data: {
                            query: val
                        },
                        success: function (searchData) {
                            jQuery('#cryptoTable').html('');

                            let coins = searchData.coins;
                            if (coins && coins.length > 0) {
                                let results = coins.slice(0, 30);

                                results.forEach(coin => {
                                    let b = document.createElement("TR");
                                    let imageUrl = coin.thumb || "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";

                                    b.innerHTML = "<td><img src=\"" + imageUrl + "\" class=\"coin-icon\"></td>"
                                        + "<td align=\"center\">" + (coin.market_cap_rank || "-") + "</td>"
                                        + "<td>" + coin.name + " (" + coin.symbol.toUpperCase() + ")</td>";
                                    b.querySelector("img").addEventListener("error", function () {
                                        this.src = "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";
                                    });

                                    b.addEventListener("click", function (e) {
                                        addToFavorites(coin.id, coin.name, coin.symbol, imageUrl);
                                        inp.value = "";
                                        jQuery('#cryptoTable').html('');
                                        displayTop100();
                                    });

                                    $("#cryptoTable").append(b);
                                });
                            } else {
                                $("#cryptoTable").append("<td colspan='3'><h4>No coin found</h4></td>");
                            }
                        },
                        error: function (xhr, status, error) {
                            if (xhr.status === 429) {
                                jQuery('#cryptoTable').html("<td colspan='3'><div style='color: #e57373; font-size: 13px; font-weight: normal; text-align: center; margin: 15px 0;'>API rate limit reached.<br>Please wait a minute before searching.</div></td>");
                            } else {
                                jQuery('#cryptoTable').html("<td colspan='3'><h4>Search error. Try again.</h4></td>");
                            }
                        }
                    });

                }, 500);
            });

            document.addEventListener("click", function (e) {
                if (e.target !== inp && !e.target.closest("#cryptoTable")) {
                    inp.value = "";
                    jQuery('#cryptoTable').html('');
                    displayTop100();
                }
            });
        }

        autocomplete(document.getElementById("coinSearch"));

        if (localStorage.getItem("arrFavsObj") !== null) {
            arrFavsObj = JSON.parse(localStorage['arrFavsObj']);
            displayFavs(arrFavsObj);
        }

        displayTop100();

        function displayTop100() {
            let count = 0;
            let displayed = 0;

            jQuery('#cryptoTable').html('');

            for (let i = 1; i < data.length && displayed < 15; i++) {
                if (!data[i] || !data[i].name) continue;

                displayed++;
                b = document.createElement("TR");
                let imageUrl = data[i].image || "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";
                b.innerHTML = "<td><img src=\"" + imageUrl + "\" class=\"coin-icon\"></td>"
                    + "<td align=\"center\">" + (data[i].rank || "N/A") + "</td>"
                    + "<td>" + data[i].name + "</td>";
                b.querySelector("img").addEventListener("error", function () {
                    this.src = "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";
                });

                b.addEventListener("click", function (e) {
                    addToFavorites(data[i].id, data[i].name, data[i].symbol, imageUrl);
                    jQuery('#cryptoTable').html('');
                    displayTop100();
                });

                $("#cryptoTable").append(b);
            }

            if (displayed === 0) {
                $("#cryptoTable").append("<td colspan='3'><h4>No coins available to display</h4></td>");
            }
        }
    }
}
