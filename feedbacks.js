const { combineRgb } = require('@companion-module/base')

module.exports = async function(self) {
	self.setFeedbackDefinitions({
		output_has_input: {
			name: 'Output has a specific input.',
			type: 'boolean',
			label: 'If an output has a specific input, set the button to this color.',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0)
			},
			options: [
				{
					type: 'dropdown',
					label: 'Input',
					id: 'input',
					default: 1,
					choices: self.CHOICES_INPUTS
				},
				{
					type: 'dropdown',
					label: 'Output',
					id: 'output',
					default: 1,
					choices: self.CHOICES_OUTPUTS
				}
			],
			callback: (feedback) => {
				// This callback will be called whenever companion wants to check if this feedback is 'active' and should affect the button style
				try {
					if (self.getVariableValue(`output_${feedback.options.output}`) == feedback.options.input) {
						return true
					} else {
						return false
					}
				} catch (error) {
					self.log('error', 'Feedback error: ' + error.message)
					return false
				}
			}
		},
		isLocked: {
			name: 'Device Buttons are Locked or Unlocked',
			type: 'boolean',
			label: 'Device Buttons are Locked or Unlocked',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(0, 0, 0)
			},
			options: [
				{
					type: 'dropdown',
					label: 'Is Locked',
					id: 'lock',
					default: '1',
					choices: [{ label: 'Unlocked', id: '1' }, { label: 'Locked', id: '2' }]
				}
			],
			callback: (feedback) => {
				// This callback will be called whenever companion wants to check if this feedback is 'active' and should affect the button style
				try {
					if (self.matrixInfo['LockKey'] == feedback.options.lock) {
						return true
					} else {
						return false
					}
				} catch (error) {
					self.log('error', 'Feedback error: ' + error.message)
					return false
				}
			}
		}
	})
}
