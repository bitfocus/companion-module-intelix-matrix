const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

// const fetch = require('node-fetch')
const http = require('http')
const querystring = require('querystring')

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config

		this.matrixInfo = {}
		this.CHOICES_INPUTS = []
		this.CHOICES_OUTPUTS = []

		this.updateStatus(InstanceStatus.Ok)

		await this.init_tcp()
		await this.updateVariableDefinitions() // export variable definitions
		await this.getMatrixInfo()

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
	}

	init_tcp() {
		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		let tcpChunks = []

		this.updateStatus('connecting', 'Connecting')

		if (this.config?.host) {
			this.socket = new TCPHelper(this.config.host, 4001)

			this.socket.on('status_change', (status, message) => {
				this.updateStatus(status, message)
			})

			this.socket.on('error', (err) => {
				this.updateStatus('unknown_error', err)
				this.log('error', 'Network error: ' + err.message)
			})

			this.socket.on('connect', () => {
				this.updateStatus('ok')
				this.log('debug', 'Connected')

				// get model info
				this.socket.send(Buffer.from(`/*Type;\r\n`, 'utf8'))
			})

			this.socket.on('data', (data) => {
				const buf = Buffer.from(data)

				if (buf.length <= 8) {
					const length = tcpChunks.length
					if (length === 0 || length === 2) {
						tcpChunks = [buf]
						return
					} else if (length === 1) {
						tcpChunks.push(buf)
						this.parseData(tcpChunks.join(''))
					}
				}
				// might need to split the lines
				// const response = buf.toString().split(/\r?\n/)
				// response.forEach((each) => this.parseData(each))
			})
		}
	}

	// When module gets deleted
	async destroy() {
		if (this.socket !== undefined) {
			this.socket.destroy()
		}

		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		this.config = config

		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		await this.init_tcp()
		try {
			await this.getMatrixInfo()
		} catch (e) {
			this.log('warning', e)
		}
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				label: 'Information',
				width: 12,
				value: `
				This should automatically pull your model but you can specify which model you have.
			`
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 8,
				regex: Regex.IP
			},
			{
				type: 'dropdown',
				label: 'Model',
				id: 'model',
				default: '4',
				choices: [
					{
						id: '4',
						label: 'INT-44HDX'
					},
					{
						id: '6',
						label: 'INT-66HDX'
					},
					{
						id: '8',
						label: 'INT-88HDX'
					}
				]
			}
		]
	}

	/**
	 * Send the TCP command to the device.
	 * @param  {string} cmd  TCP Command
	 * @return {void}
	 */
	sendToDevice(cmd) {
		const end = '\r\n'
		let sendBuf = Buffer.from(cmd + end, 'latin1')

		if (sendBuf != '') {
			this.log('debug', `sending ${sendBuf} to ${this.config.host}`)

			if (this.socket !== undefined && this.socket.isConnected) {
				this.socket.send(sendBuf).catch((e) => this.log('error', `Could not connect to device. ${e}`))
			} else {
				this.log('debug', 'Socket not connected :(')
			}
		}
	}

	/**
	 * This computes all the Inputs and Outputs of the device using the names recieved
	 * from the matrix. This sets the global variables CHOICES_INPUTS and CHOICES_OUTPUTS.
	 * @return {void}
	 */
	setupChoices() {
		const totalInputs = parseInt(this.config?.model)
		this.CHOICES_INPUTS = []
		this.CHOICES_OUTPUTS = []

		if (totalInputs === undefined) {
			return
		}

		if (this.matrixInfo['admpassword'] !== undefined) {
			for (let index = 0; index < totalInputs; index++) {
				this.CHOICES_INPUTS.push({
					id: `${index + 1}`,
					label: this.matrixInfo[`Input${index + 1}Table`]
				})
				this.CHOICES_OUTPUTS.push({
					id: `${index + 1}`,
					label: this.matrixInfo[`Output${index + 1}Table`]
				})
			}
		} else {
			for (let index = 0; index < totalInputs; index++) {
				this.CHOICES_INPUTS.push({
					id: `${index + 1}`,
					label: `Input ${index + 1}`
				})
				this.CHOICES_OUTPUTS.push({
					id: `${index + 1}`,
					label: `Output ${index + 1}`
				})
			}
		}
	}

	/**
	 * This is a workaround for a fetch request because Node 18 has a bug and can't
	 * process the headers correctly.
	 * @param  {url} url               The URL to request
	 * @param  {JSON Object} body      The POST Body
	 * @return {string}      The response as a string
	 */
	makeRequest(url, body) {
		return new Promise((resolve, reject) => {
			const postData = querystring.stringify(body)

			const options = {
				method: 'POST',
				headers: {
					'Content-Type': 'application/javascript',
					'Content-Length': Buffer.byteLength(postData)
				},
				insecureHTTPParser: true
			}

			const req = http.request(url, options, (res) => {
				let data = ''
				res.on('data', (chunk) => {
					data += chunk
				})
				res.on('end', () => {
					resolve(data)
				})
			})

			req.on('error', (error) => {
				reject(error)
			})

			req.write(postData)
			req.end()
		})
	}

	/**
	 * Get Device info from Matrix. This uses the device's web server to get information.
	 * It then stores it as this.matrixInfo
	 * @return {Promise} Returns the received data as json object.
	 */
	async getMatrixInfo() {
		if (this.config?.model === undefined) {
			return
		}
		const model = this.config.model + this.config.model
		const body = {
			tag: 'ptn'
		}

		try {
			const url = `http://${this.config.host}/cgi-bin/MUH${model}TP_getsetparams.cgi`
			const response = await this.makeRequest(url, body)

			// This section doesn't work due to a bug with Node 18
			// const response = await fetch(`http://${this.config.host}/cgi-bin/MUH${model}TP_getsetparams.cgi`,
			// 	{
			// 	method: 'post',
			// 	body: JSON.stringify(body),
			// 	headers: {
			// 		'content-type': 'application/json'
			// 	},
			// 	insecureHTTPParser: true
			// }
			// )
			// const dataText = await response.text()

			const data = JSON.parse(response.substring(2, response.length - 1).replace(/'/g, '"'))
			this.matrixInfo = data

			this.updateActions()
			this.checkFeedbacks('output_has_input')

			const totalInputs = parseInt(model)
			const outputVariables = {}
			for (let index = 0; index < totalInputs; index++) {
				outputVariables[`output_${index + 1}`] = data[`CH${index + 1}Output`]
				outputVariables[`input_${index + 1}_label`] = data[`Input${index + 1}Table`]
				outputVariables[`output_${index + 1}_label`] = data[`Output${index + 1}Table`]
				outputVariables[`input_${index + 1}_hdcp`] = data[`Input${index + 1}HDCP`]
			}

			this.setVariableValues(outputVariables)

			if (data.LockKey) {
				this.setVariableValues({ lock_state: 'Unlocked' })
			} else {
				this.setVariableValues({ lock_state: 'Locked' })
			}

			this.setVariableValues({
				title_label: data['TitleLabelTable'],
				lcd_readout_1: data['LCDReadout1'],
				lcd_readout_2: data['LCDReadout2']
			})

			return this.matrixInfo
		} catch (error) {
			this.log('error', 'Network error: ' + error.message)
			console.error(error)
		}
	}

	/**
	 * Handle all the TCP data from the device. This sets variables and checks feedbacks.
	 * @param  {string} data   This is the data from the device.
	 * @return {void}
	 */
	parseData(data) {
		// Get model info INT-66HDX
		// 4x4: "INT-44HD"
		// 6x6: "INT-66HD"
		if (data.substring(0, 3) === 'INT') {
			this.config.model = data.substring(5, 6)
			// this.setVariable('model', data.substring(0, 9))
			this.saveConfig({ model: data.substring(5, 6), host: this.config.host })
			return
		}
		// Get Version
		if (data.substring(0, 1) === 'V') {
			this.setVariableValues({ version: data })
			return
		}
		// Get if system front panel is locked System Locked!
		if (data.substring(0, 6) === 'System') {
			if (data.substring(7, 8) === 'L') {
				this.matrixInfo['LockKey'] = '2'
				this.setVariableValues({ lock_state: 'Locked' })
			} else {
				this.matrixInfo['LockKey'] = '1'
				this.setVariableValues({ lock_state: 'Unlocked' })
			}
			this.checkFeedbacks()
			return
		}
		// Get Status of individual output AV:  2-> 2 AV: input-> output
		// 6x6 "AV:  2-> 2"
		// 4x4 "AV:01->02"
		if (data.substring(0, 2) === 'AV') {
			//AV:  3-> 1
			const i = parseInt(data.slice(3, -4), 10)
			const o = parseInt(data.substring(8), 10)
			const outputVar = {}
			outputVar[`output_${o}`] = `${i}`
			this.setVariableValues(outputVar)
			this.checkFeedbacks()
			return
		}
		// Process switch command 4 To All
		const inputNumber = parseInt(data.substring(0, 2), 10)
		const totalInputs = parseInt(this.config?.model)
		if (inputNumber >= 0 && inputNumber <= 8) {
			// Process All
			// On the 6x6 it returns "2 To All"
			// On the 4x4 it returns "02 To Al"
			if (data.substring(5, 8) === 'All' || data.substring(3, 8) === 'To Al') {
				const outputVar = {}
				for (let index = 0; index < totalInputs; index++) {
					outputVar[`output_${index + 1}`] = `${inputNumber}`
				}

				this.setVariableValues(outputVar)
				this.checkFeedbacks()
				return
			} else if (data.substring(1, 2 === 'B')) {
				// xBy
				const input = data.substring(0, 1)
				const output = data.substring(2, 3)
				const outputVar2 = {}
				outputVar2[`output_${output}`] = input
				this.setVariableValues(outputVar2)
				this.checkFeedbacks()
				return
			}
		}
		// Process All through // All Through.
		if (data.substring(0, 5) === 'All T') {
			const allThroughVars = {}
			for (let index = 0; index < totalInputs; index++) {
				allThroughVars[`output_${index + 1}`] = index + 1
			}
			this.setVariableValues(allThroughVars)
			this.checkFeedbacks()
			return
		}

		// if nothing matches but this was triggered then get everything just in case
		// This probably is unnecessary but might be helpful with updating input naming
		this.getMatrixInfo()
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
