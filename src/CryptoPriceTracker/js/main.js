// by SoKo for kriptoentuzijasti.io
// last update: March 4, 2026

let storedFavsId = [];
let storedPropFavs = [];
let sortOptions = '';
let currencyOption = "";

if (localStorage.getItem("sortOptions") !== null) {
	sortOptions = localStorage['sortOptions'];
} else {
	sortOptions = "rankAsc";
	localStorage['sortOptions'] = sortOptions;
}

if (localStorage.getItem("currencyOption") !== null) {
	currencyOption = localStorage['currencyOption'];
} else {
	currencyOption = "usd";
	localStorage['currencyOption'] = currencyOption;
}

milliseconds = (new Date).getTime();

if (localStorage.getItem("milliseconds") !== null) {
	storedMS = parseInt(localStorage['milliseconds']);
} else {
	localStorage['milliseconds'] = milliseconds;
	storedMS = parseInt(localStorage['milliseconds']);
}

/**
 * Checks if the extension has the necessary host permissions for CoinGecko.
 * If not, shows a permission request UI.
 */
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
		<td colspan="8" style="text-align: center; padding: 40px 10px; border: none; background: transparent;">
			<div class="permission-prompt" style="display: block; margin: 0 auto; max-width: 420px; text-align: center;">
				<h2 style="margin-bottom: 20px; font-weight: 700; color: var(--text-primary); font-size: 24px;">Data Access Permission</h2>
				<p style="font-size: 15px; color: var(--text-secondary); margin-bottom: 30px; line-height: 1.6; padding: 0 20px;">
					Please grant permission to allow the extension to fetch real-time market data from CoinGecko.
				</p>
				<button id="grantPermissionBtn" class="btn btn-primary" style="background-color: #2196F3; border: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px rgba(33, 150, 243, 0.25); display: inline-block; font-size: 15px; transition: all 0.2s ease;">
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
				alert("Access is required for the extension to function.");
			}
		});
	});
}

$(document).ready(function () {
	checkAndRequestPermissions(() => {
		initializeUI();
	});
});

function initializeUI() {
	if (localStorage.getItem("arrFavsObj") !== null && JSON.parse(localStorage.getItem("arrFavsObj")).length > 0) {
		let arrFavsObj = JSON.parse(localStorage['arrFavsObj']);
		arrFavsObj.forEach(function (element) {
			storedFavsId.push(element.favsId);
		});
		start(storedFavsId);
	} else {
		jQuery('#cryptoTable').html('<td colspan="2"><div align="center" id="symbol" title="Options"><a href="../html/options.html" target="blank" class="options-icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></a></div></td><td colspan="4"><h4>Please select a coin to track</h4><td>');
	}

	function start(favsArr) {

		if ((storedMS + 600) < milliseconds) {

			jQuery('#cryptoTable').html('');
			jQuery('#cryptoTable').html("<td><div class='spinner-grow' role='status'><span class='sr-only'>Loading...</span></div></td><td><h4>Loading...</h4></td>");
			localStorage['milliseconds'] = (new Date).getTime();
			finalString = favsArr.join(",");

			console.log(finalString);

			$.ajax({
				type: "GET",
				url: "https://api.coingecko.com/api/v3/coins/markets",
				dataType: "json",
				data: {
					ids: finalString,
					vs_currency: currencyOption,
					order: "market_cap_desc",
					per_page: 250,
					page: 1,
					sparkline: false,
					price_change_percentage: "24h"
				},
				crossDomain: true,
				success: function (data) {
					console.log(data);
					let finalData = data.map(item => {
						return {
							id: item.id,
							symbol: item.symbol,
							name: item.name,
							rank: item.market_cap_rank,
							priceUsd: item.current_price,
							changePercent24Hr: item.price_change_percentage_24h,
							marketCapUsd: item.market_cap,
							image: item.image
						};
					});

					storedPropFavs = {
						currency: currencyOption,
						data: finalData
					};
					localStorage['storedPropFavs'] = JSON.stringify(storedPropFavs);

					sortDisplay(storedPropFavs.data);
				},
				error: function (xhr, status, error) {
					console.error("API Error:", error);

					if (xhr.status === 429) {
						jQuery('#cryptoTable').html("<td colspan='6'><div style='color: #e57373; font-size: 13px; font-weight: normal; text-align: center; margin: 15px 0;'>CoinGecko API rate limit reached.<br>Please wait a minute and try again.</div></td>");
					} else {
						jQuery('#cryptoTable').html("<td colspan='6'><h4 style='text-align: center; margin: 15px 0;'>Error loading data. Please try again later.</h4></td>");
					}

					if (localStorage.getItem("storedPropFavs") !== null) {
						let cached = JSON.parse(localStorage['storedPropFavs']);
						if (cached.currency === currencyOption) {
							sortDisplay(cached.data);
						} else {
							jQuery('#cryptoTable').html("<td colspan='6'><div style='color: #e57373; font-size: 13px; font-weight: normal; text-align: center; margin: 15px 0;'>CoinGecko API rate limit reached.<br>Please wait a minute to fetch " + currencyOption.toUpperCase() + " prices.</div></td>");
						}
					}
				}
			});
		} else {
			let cached = JSON.parse(localStorage['storedPropFavs']);
			if (cached.currency === currencyOption) {
				sortDisplay(cached.data);
			} else {
				milliseconds = (new Date).getTime();
				storedMS = 0;
				start(favsArr);
			}
		}
	}

	function displayCoins(dataToDisplay) {
		jQuery('#cryptoTable').html('');
		for (let propertyName in dataToDisplay) {
			b = document.createElement("TR");
			let imageUrl = "https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png";
			if (dataToDisplay[propertyName].image) {
				imageUrl = dataToDisplay[propertyName].image;
			}
			b.innerHTML = "<td align=\"center\"><img src=\"" + imageUrl + "\" class=\"coin-icon\"></td>"
			b.innerHTML += "<td>" + dataToDisplay[propertyName].symbol.toUpperCase() + "</td><td align=\"center\">" + dataToDisplay[propertyName].rank + "</td>";
			b.innerHTML += "<td><a href=\"https://www.coingecko.com/en/coins/" + dataToDisplay[propertyName].id + "\" target=\"blank\">" + dataToDisplay[propertyName].name + "</a</td>";
			let num = Number(dataToDisplay[propertyName].priceUsd);

			let maxDecimals = 2;
			if (num < 0.000001) {
				maxDecimals = 10;
			} else if (num < 0.0001) {
				maxDecimals = 8;
			} else if (num < 0.1) {
				maxDecimals = 5;
			}

			b.innerHTML += "<td align=\"right\">" + new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: currencyOption.toUpperCase(),
				currencyDisplay: 'narrowSymbol',
				minimumFractionDigits: 2,
				maximumFractionDigits: maxDecimals
			}).format(num) + "</td><td></td><td></td>";

			let change24h = dataToDisplay[propertyName].changePercent24Hr;
			if (change24h == null) {
				change24h = 0
			}

			if (change24h > 0) {
				b.innerHTML += "<td align=\"center\"><div class=\"positive-change\">" + parseFloat(change24h).toFixed(2) + "%</div></td>";
			} else {
				b.innerHTML += "<td align=\"center\"><div class=\"negative-change\">" + parseFloat(change24h).toFixed(2) + "%</div></td>";
			}
			$("#cryptoTable").append(b);
		}
	}

	function sortDisplay(dataToSort, settings) {

		switch (settings) {
			case 'rank':
				if (sortOptions == 'rankAsc') {
					sortOptions = 'rankDesc';
				} else {
					sortOptions = 'rankAsc';
				}
				break;
			case 'name':
				if (sortOptions == 'nameAsc') {
					sortOptions = 'nameDesc';
				} else {
					sortOptions = 'nameAsc';
				}
				break;
			case 'price':
				if (sortOptions == 'priceAsc') {
					sortOptions = 'priceDesc';
				} else {
					sortOptions = 'priceAsc';
				}
				break;
			case 'change':
				if (sortOptions == 'changeAsc') {
					sortOptions = 'changeDesc';
				} else {
					sortOptions = 'changeAsc';
				}
				break;
		}

		switch (sortOptions) {
			case 'rankAsc':
				dataToSort.sort(function (a, b) {
					return a.rank - b.rank
				});
				break;
			case 'rankDesc':
				dataToSort.sort(function (a, b) {
					return b.rank - a.rank
				});
				break;
			case 'nameAsc':
				dataToSort.sort((a, b) => a.name.localeCompare(b.name));
				break;
			case 'nameDesc':
				dataToSort.sort((a, b) => b.name.localeCompare(a.name));
				break;
			case 'priceAsc':
				dataToSort.sort(function (a, b) {
					return a.priceUsd - b.priceUsd
				});
				break;
			case 'priceDesc':
				dataToSort.sort(function (a, b) {
					return b.priceUsd - a.priceUsd
				});
				break;
			case 'changeAsc':
				dataToSort.sort(function (a, b) {
					return a.changePercent24Hr - b.changePercent24Hr
				});
				break;
			case 'changeDesc':
				dataToSort.sort(function (a, b) {
					return b.changePercent24Hr - a.changePercent24Hr
				});
				break;
		}

		localStorage['sortOptions'] = sortOptions;
		displayCoins(dataToSort);

	}

	$("#rank").click(function () {
		toggleSortMode("rank");
	});
	$("#name").click(function () {
		toggleSortMode("name");
	});
	$("#price").click(function () {
		toggleSortMode("price");
	});
	$("#change").click(function () {
		toggleSortMode("change");
	});

	function toggleSortMode(settings) {
		switch (settings) {
			case 'rank':
				if (sortOptions == 'rankAsc') {
					sortOptions = 'rankDesc';
				} else {
					sortOptions = 'rankAsc';
				}
				break;
			case 'name':
				if (sortOptions == 'nameAsc') {
					sortOptions = 'nameDesc';
				} else {
					sortOptions = 'nameAsc';
				}
				break;
			case 'price':
				if (sortOptions == 'priceAsc') {
					sortOptions = 'priceDesc';
				} else {
					sortOptions = 'priceAsc';
				}
				break;
			case 'change':
				if (sortOptions == 'changeAsc') {
					sortOptions = 'changeDesc';
				} else {
					sortOptions = 'changeAsc';
				}
				break;
		}

		if (localStorage.getItem("storedPropFavs") !== null) {
			let cached = JSON.parse(localStorage['storedPropFavs']);
			if (cached.currency === currencyOption) {
				sortDisplay(cached.data, null);
			}
		}
	}

	let myOptions = [
		{ val: "usd", text: "$ USD" },
		{ val: "eur", text: "€ EUR" },
		{ val: "gbp", text: "£ GBP" },
		{ val: "jpy", text: "¥ JPY" },
		{ val: "rub", text: "₽ RUB" },
		{ val: "cny", text: "¥ CNY" },
		{ val: "chf", text: "₣ CHF" },
		{ val: "cad", text: "$ CAD" }
	];

	let currencyCooldownInterval;

	function checkCurrencyCooldown() {
		let cooldownUntil = localStorage.getItem('currencyCooldownUntil');
		if (cooldownUntil) {
			let now = Date.now();
			let timeLeft = parseInt(cooldownUntil) - now;

			if (timeLeft > 0) {
				$('#currency').prop('disabled', true);

				if (currencyCooldownInterval) {
					clearInterval(currencyCooldownInterval);
				}

				const updateText = () => {
					let currentNow = Date.now();
					let secondsLeft = Math.ceil((parseInt(cooldownUntil) - currentNow) / 1000);

					if (secondsLeft > 0) {
						let currentVal = $('#currency').val();
						let defaultText = myOptions.find(opt => opt.val === currentVal).text;
						$('#currency option:selected').text(`${defaultText} (Wait ${secondsLeft}s)`);
					} else {
						clearInterval(currencyCooldownInterval);
						$('#currency').prop('disabled', false);
						let currentVal = $('#currency').val();
						let defaultText = myOptions.find(opt => opt.val === currentVal).text;
						$('#currency option:selected').text(defaultText);
						localStorage.removeItem('currencyCooldownUntil');
					}
				};

				updateText();
				currencyCooldownInterval = setInterval(updateText, 1000);
			} else {
				localStorage.removeItem('currencyCooldownUntil');
			}
		}
	}

	$.each(myOptions, function (i, item) {
		$('#currency').append($('<option></option>').val(item.val).html(item.text))
	});

	$("#currency").val(currencyOption);

	checkCurrencyCooldown();

	$('#currency').change(function () {
		localStorage['currencyOption'] = $(this).val();
		currencyOption = $(this).val();

		// Start the 30 second cooldown
		localStorage.setItem('currencyCooldownUntil', Date.now() + 30000);
		checkCurrencyCooldown();

		if (storedFavsId.length > 0) {
			milliseconds = (new Date).getTime();
			storedMS = 0;

			start(storedFavsId);
		}
	});
}
